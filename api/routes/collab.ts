import { Router, type Response } from 'express';
import { Sandboxes, Users, Collaborations } from '../db/store.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';

const router = Router({ mergeParams: true });

router.post('/invite', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const sandboxId = Number(req.params.id);
  const { email, permission } = req.body;

  if (!email || !permission) {
    res.status(400).json({ success: false, error: 'email and permission are required' });
    return;
  }

  const sandbox = Sandboxes.findById(sandboxId);
  if (!sandbox) {
    res.status(404).json({ success: false, error: 'Sandbox not found' });
    return;
  }

  if (sandbox.user_id !== req.user!.userId) {
    res.status(403).json({ success: false, error: 'Only the sandbox owner can invite' });
    return;
  }

  const targetUser = Users.findByEmail(email);
  if (!targetUser) {
    res.status(404).json({ success: false, error: 'User not found' });
    return;
  }

  const existing = Collaborations.findBySandboxIdAndUserId(sandboxId, targetUser.id);
  if (existing) {
    res.status(409).json({ success: false, error: 'User already has access' });
    return;
  }

  const collab = Collaborations.create({
    sandbox_id: sandboxId,
    user_id: targetUser.id,
    permission: permission as 'edit' | 'read',
  });

  const inviteUrl = `${req.protocol}://${req.get('host')}/workspace/${sandboxId}?invite=${collab.id}`;

  res.status(201).json({ success: true, inviteUrl, collaboration: collab });
});

router.get('/users', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const sandboxId = Number(req.params.id);

  const sandbox = Sandboxes.findById(sandboxId);
  if (!sandbox) {
    res.status(404).json({ success: false, error: 'Sandbox not found' });
    return;
  }

  const collabs = Collaborations.findBySandboxId(sandboxId);
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
