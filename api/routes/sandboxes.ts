import { Router, type Response } from 'express';
import { Sandboxes, Users, Collaborations } from '../db/store.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { checkSandboxAccess, requireEditPermission, requireOwnerPermission } from '../middleware/permissions.js';
import { startSandbox, stopSandbox, getSandboxStatus, initDefaultFiles } from '../services/sandbox.js';

const router = Router();

router.get('/', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const ownedSandboxes = Sandboxes.findByUserId(req.user!.userId);
  const collaborations = Collaborations.findByUserId(req.user!.userId);
  const collabSandboxIds = new Set(collaborations.map((c) => c.sandbox_id));
  const collabSandboxes = collabSandboxIds.size > 0
    ? Sandboxes.findAll().filter((s) => collabSandboxIds.has(s.id))
    : [];

  const uniqueMap = new Map<number, typeof ownedSandboxes[0]>();
  for (const s of ownedSandboxes) uniqueMap.set(s.id, s);
  for (const s of collabSandboxes) uniqueMap.set(s.id, s);

  const sandboxes = Array.from(uniqueMap.values());
  res.json({ success: true, sandboxes });
});

router.post('/', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const { name, language } = req.body;

  if (!name || !language) {
    res.status(400).json({ success: false, error: 'name and language are required' });
    return;
  }

  const validLanguages = ['python', 'nodejs', 'cpp', 'rust'];
  if (!validLanguages.includes(language)) {
    res.status(400).json({ success: false, error: 'language must be one of: python, nodejs, cpp, rust' });
    return;
  }

  const user = Users.findById(req.user!.userId);
  if (!user) {
    res.status(404).json({ success: false, error: 'User not found' });
    return;
  }

  const userSandboxes = Sandboxes.findByUserId(req.user!.userId);
  if (userSandboxes.length >= user.sandbox_limit) {
    res.status(403).json({ success: false, error: `Sandbox limit reached (${user.sandbox_limit})` });
    return;
  }

  const sandbox = Sandboxes.create({
    user_id: req.user!.userId,
    name,
    language,
    status: 'stopped',
    vm_id: null,
    cpu_limit_percent: 50,
    memory_limit_mb: 256,
    disk_limit_mb: 500,
  });

  initDefaultFiles(sandbox.id, language);

  res.status(201).json({ success: true, sandbox });
});

router.post('/:id/start', authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const access = checkSandboxAccess(req, res);
  if (!access) return;
  if (!requireEditPermission(access, res)) return;

  const { sandboxId } = access;

  const updated = await startSandbox(sandboxId);
  if (!updated) {
    res.status(500).json({ success: false, error: 'Failed to start sandbox' });
    return;
  }

  res.json({ success: true, sandbox: updated });
});

router.post('/:id/stop', authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const access = checkSandboxAccess(req, res);
  if (!access) return;
  if (!requireEditPermission(access, res)) return;

  const { sandboxId } = access;

  const updated = await stopSandbox(sandboxId);
  res.json({ success: true, sandbox: updated });
});

router.delete('/:id', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const access = checkSandboxAccess(req, res);
  if (!access) return;
  if (!requireOwnerPermission(access, res)) return;

  const { sandboxId } = access;

  Sandboxes.delete(sandboxId);
  res.json({ success: true });
});

router.get('/:id/status', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const access = checkSandboxAccess(req, res);
  if (!access) return;

  const { sandboxId } = access;

  const status = getSandboxStatus(sandboxId);
  if (!status) {
    res.status(404).json({ success: false, error: 'Sandbox status not available' });
    return;
  }

  res.json({ success: true, status: status.status, metrics: status.metrics });
});

export default router;
