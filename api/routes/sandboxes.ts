import { Router, type Response } from 'express';
import { Sandboxes, Users } from '../db/store.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { startSandbox, stopSandbox, getSandboxStatus, initDefaultFiles } from '../services/sandbox.js';

const router = Router();

router.get('/', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const sandboxes = Sandboxes.findByUserId(req.user!.userId);
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
  const sandbox = Sandboxes.findById(Number(req.params.id));
  if (!sandbox) {
    res.status(404).json({ success: false, error: 'Sandbox not found' });
    return;
  }

  if (sandbox.user_id !== req.user!.userId) {
    res.status(403).json({ success: false, error: 'Not your sandbox' });
    return;
  }

  const updated = await startSandbox(sandbox.id);
  if (!updated) {
    res.status(500).json({ success: false, error: 'Failed to start sandbox' });
    return;
  }

  const wsUrl = `ws://localhost:${process.env.PORT || 3001}/ws/sandbox/${sandbox.id}`;
  res.json({ success: true, sandbox: updated, wsUrl });
});

router.post('/:id/stop', authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const sandbox = Sandboxes.findById(Number(req.params.id));
  if (!sandbox) {
    res.status(404).json({ success: false, error: 'Sandbox not found' });
    return;
  }

  if (sandbox.user_id !== req.user!.userId) {
    res.status(403).json({ success: false, error: 'Not your sandbox' });
    return;
  }

  const updated = await stopSandbox(sandbox.id);
  res.json({ success: true, sandbox: updated });
});

router.delete('/:id', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const sandbox = Sandboxes.findById(Number(req.params.id));
  if (!sandbox) {
    res.status(404).json({ success: false, error: 'Sandbox not found' });
    return;
  }

  if (sandbox.user_id !== req.user!.userId) {
    res.status(403).json({ success: false, error: 'Not your sandbox' });
    return;
  }

  Sandboxes.delete(sandbox.id);
  res.json({ success: true });
});

router.get('/:id/status', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const sandbox = Sandboxes.findById(Number(req.params.id));
  if (!sandbox) {
    res.status(404).json({ success: false, error: 'Sandbox not found' });
    return;
  }

  if (sandbox.user_id !== req.user!.userId) {
    res.status(403).json({ success: false, error: 'Not your sandbox' });
    return;
  }

  const status = getSandboxStatus(sandbox.id);
  if (!status) {
    res.status(404).json({ success: false, error: 'Sandbox status not available' });
    return;
  }

  res.json({ success: true, status: status.status, metrics: status.metrics });
});

export default router;
