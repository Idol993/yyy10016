import { Router, type Response } from 'express';
import { Sandboxes, Users, Collaborations } from '../db/store.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { checkSandboxAccess, requireOwnerPermission } from '../middleware/permissions.js';

const router = Router({ mergeParams: true });

router.post('/invite', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const access = checkSandboxAccess(req, res);
  if (!access) return;
  if (!requireOwnerPermission(access, res)) return;

  const { email, permission } = req.body;

  if (!email || !permission) {
    res.status(400).json({ success: false, error: 'email and permission are required' });
    return;
  }

  if (!['edit', 'read'].includes(permission)) {
    res.status(400).json({ success: false, error: 'permission must be edit or read' });
    return;
  }

  const targetUser = Users.findByEmail(email);
  if (!targetUser) {
    res.status(404).json({ success: false, error: 'User not found' });
    return;
  }

  if (targetUser.id === access.userId) {
    res.status(400).json({ success: false, error: 'Cannot invite yourself' });
    return;
  }

  const existing = Collaborations.findBySandboxIdAndUserId(access.sandboxId, targetUser.id);
  if (existing) {
    res.status(409).json({ success: false, error: 'User already has access' });
    return;
  }

  const collab = Collaborations.create({
    sandbox_id: access.sandboxId,
    user_id: targetUser.id,
    permission: permission as 'edit' | 'read',
  });

  const inviteUrl = `${req.protocol}://${req.get('host')}/workspace/${access.sandboxId}?invite=${collab.id}`;

  res.status(201).json({ success: true, inviteUrl, collaboration: collab });
});

router.get('/users', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const access = checkSandboxAccess(req, res);
  if (!access) return;

  const sandbox = Sandboxes.findById(access.sandboxId);
  if (!sandbox) {
    res.status(404).json({ success: false, error: 'Sandbox not found' });
    return;
  }

  const collabs = Collaborations.findBySandboxId(access.sandboxId);
  const owner = Users.findById(sandbox.user_id);

  const users = [
    ...(owner
      ? [{ id: owner.id, email: owner.email, username: owner.username, permission: 'owner' as const }]
      : []),
    ...collabs.map((c) => {
      const u = Users.findById(c.user_id);
      return u
        ? { id: u.id, email: u.email, username: u.username, permission: c.permission as 'edit' | 'read' }
        : null;
    }).filter(Boolean),
  ];

  res.json({ success: true, users });
});

export default router;
