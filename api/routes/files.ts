import { Router, type Response } from 'express';
import { Sandboxes, FileNodes, Collaborations } from '../db/store.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { createSnapshot, rollbackToSnapshot, listSnapshots } from '../services/vfs.js';

const router = Router({ mergeParams: true });

function verifySandboxAccess(req: AuthenticatedRequest, res: Response): boolean {
  const sandboxId = Number(req.params.id);
  const sandbox = Sandboxes.findById(sandboxId);
  if (!sandbox) {
    res.status(404).json({ success: false, error: 'Sandbox not found' });
    return false;
  }

  if (sandbox.user_id === req.user!.userId) return true;

  const collab = Collaborations.findBySandboxIdAndUserId(sandboxId, req.user!.userId);
  if (collab) return true;

  res.status(403).json({ success: false, error: 'No access to this sandbox' });
  return false;
}

router.get('/', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  if (!verifySandboxAccess(req, res)) return;

  const sandboxId = Number(req.params.id);
  const queryPath = (req.query.path as string) || '/';
  const getAll = req.query.all === 'true';

  let files;
  if (getAll) {
    files = FileNodes.findBySandboxId(sandboxId);
  } else {
    files = FileNodes.findBySandboxIdAndParent(sandboxId, queryPath);
  }

  res.json({ success: true, files });
});

router.get('/content', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  if (!verifySandboxAccess(req, res)) return;

  const sandboxId = Number(req.params.id);
  const filePath = req.query.path as string;

  if (!filePath) {
    res.status(400).json({ success: false, error: 'path query parameter is required' });
    return;
  }

  const node = FileNodes.findBySandboxIdAndPath(sandboxId, filePath);
  if (!node) {
    res.status(404).json({ success: false, error: 'File not found' });
    return;
  }

  if (node.type === 'directory') {
    res.status(400).json({ success: false, error: 'Cannot read content of a directory' });
    return;
  }

  res.json({ success: true, content: node.content, node });
});

router.put('/content', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  if (!verifySandboxAccess(req, res)) return;

  const sandboxId = Number(req.params.id);
  const { path: filePath, content } = req.body;

  if (!filePath || content === undefined) {
    res.status(400).json({ success: false, error: 'path and content are required' });
    return;
  }

  const node = FileNodes.findBySandboxIdAndPath(sandboxId, filePath);
  if (!node) {
    res.status(404).json({ success: false, error: 'File not found' });
    return;
  }

  const updated = FileNodes.update(node.id, { content });
  res.json({ success: true, node: updated });
});

router.post('/', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  if (!verifySandboxAccess(req, res)) return;

  const sandboxId = Number(req.params.id);
  const { path: parentPath, name, type } = req.body;

  if (!parentPath || !name || !type) {
    res.status(400).json({ success: false, error: 'path, name, and type are required' });
    return;
  }

  if (!['file', 'directory'].includes(type)) {
    res.status(400).json({ success: false, error: 'type must be file or directory' });
    return;
  }

  const fullPath = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`;

  const existing = FileNodes.findBySandboxIdAndPath(sandboxId, fullPath);
  if (existing) {
    res.status(409).json({ success: false, error: 'Path already exists' });
    return;
  }

  const node = FileNodes.create({
    sandbox_id: sandboxId,
    path: fullPath,
    name,
    type: type as 'file' | 'directory',
    content: type === 'file' ? '' : null,
  });

  res.status(201).json({ success: true, node });
});

router.post('/mkdir', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  if (!verifySandboxAccess(req, res)) return;

  const sandboxId = Number(req.params.id);
  const { path: parentPath, name } = req.body;

  if (!parentPath || !name) {
    res.status(400).json({ success: false, error: 'path and name are required' });
    return;
  }

  const dirPath = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`;

  const existing = FileNodes.findBySandboxIdAndPath(sandboxId, dirPath);
  if (existing) {
    res.status(409).json({ success: false, error: 'Path already exists' });
    return;
  }

  const node = FileNodes.create({
    sandbox_id: sandboxId,
    path: dirPath,
    name,
    type: 'directory',
    content: null,
  });

  res.status(201).json({ success: true, node });
});

router.delete('/', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  if (!verifySandboxAccess(req, res)) return;

  const sandboxId = Number(req.params.id);
  const filePath = req.query.path as string;

  if (!filePath || filePath === '/') {
    res.status(400).json({ success: false, error: 'Cannot delete root directory' });
    return;
  }

  const deleted = FileNodes.deleteByPath(sandboxId, filePath);
  if (!deleted) {
    res.status(404).json({ success: false, error: 'Path not found' });
    return;
  }

  res.json({ success: true });
});

router.post('/snapshots', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  if (!verifySandboxAccess(req, res)) return;

  const sandboxId = Number(req.params.id);
  const { label } = req.body;

  if (!label) {
    res.status(400).json({ success: false, error: 'label is required' });
    return;
  }

  const snapshot = createSnapshot(sandboxId, label);
  if (!snapshot) {
    res.status(500).json({ success: false, error: 'Failed to create snapshot' });
    return;
  }

  res.status(201).json({ success: true, snapshot });
});

router.post('/snapshots/:sid/rollback', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  if (!verifySandboxAccess(req, res)) return;

  const sandboxId = Number(req.params.id);
  const snapshotId = Number(req.params.sid);

  const success = rollbackToSnapshot(sandboxId, snapshotId);
  if (!success) {
    res.status(400).json({ success: false, error: 'Failed to rollback to snapshot' });
    return;
  }

  res.json({ success: true });
});

router.get('/snapshots', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  if (!verifySandboxAccess(req, res)) return;

  const sandboxId = Number(req.params.id);
  const snapshots = listSnapshots(sandboxId);

  res.json({ success: true, snapshots });
});

export default router;
