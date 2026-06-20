import { Router, type Response } from 'express';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { checkSandboxAccess, requireEditPermission } from '../middleware/permissions.js';
import {
  listDir,
  listAllFs,
  readFileFromFs,
  writeFileToFs,
  createFileFs,
  deleteFromFs,
  renameInFs,
  createSnapshotFs,
  rollbackFromSnapshotFs,
  deleteSnapshotFs,
  type FsEntry,
} from '../services/sandboxFs.js';
import { Snapshots } from '../db/store.js';

const router = Router({ mergeParams: true });

function fsEntryToNode(sandboxId: number, entry: FsEntry) {
  return {
    id: 0,
    sandbox_id: sandboxId,
    path: entry.path,
    name: entry.name,
    type: entry.type,
    content: null,
    modified_at: entry.modified_at,
  };
}

router.get('/', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const access = checkSandboxAccess(req, res);
  if (!access) return;

  const { sandboxId } = access;
  const queryPath = (req.query.path as string) || '/';
  const getAll = req.query.all === 'true';

  const entries = getAll ? listAllFs(sandboxId) : listDir(sandboxId, queryPath);
  const files = entries.map((e) => fsEntryToNode(sandboxId, e));

  res.json({ success: true, files });
});

router.get('/content', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const access = checkSandboxAccess(req, res);
  if (!access) return;

  const { sandboxId } = access;
  const filePath = req.query.path as string;

  if (!filePath) {
    res.status(400).json({ success: false, error: 'path query parameter is required' });
    return;
  }

  const content = readFileFromFs(sandboxId, filePath);
  if (content === null) {
    res.status(404).json({ success: false, error: 'File not found' });
    return;
  }

  const allEntries = listAllFs(sandboxId);
  const entry = allEntries.find((e) => e.path === filePath);
  if (!entry || entry.type !== 'file') {
    res.status(400).json({ success: false, error: 'Cannot read content of a directory' });
    return;
  }

  res.json({ success: true, content, node: fsEntryToNode(sandboxId, entry) });
});

router.put('/content', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const access = checkSandboxAccess(req, res);
  if (!access) return;
  if (!requireEditPermission(access, res)) return;

  const { sandboxId } = access;
  const { path: filePath, content } = req.body;

  if (!filePath || content === undefined) {
    res.status(400).json({ success: false, error: 'path and content are required' });
    return;
  }

  const ok = writeFileToFs(sandboxId, filePath, content);
  if (!ok) {
    res.status(500).json({ success: false, error: 'Failed to write file' });
    return;
  }

  const allEntries = listAllFs(sandboxId);
  const entry = allEntries.find((e) => e.path === filePath);
  const node = entry ? fsEntryToNode(sandboxId, entry) : null;

  res.json({ success: true, node });
});

router.post('/', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const access = checkSandboxAccess(req, res);
  if (!access) return;
  if (!requireEditPermission(access, res)) return;

  const { sandboxId } = access;
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
  const allEntries = listAllFs(sandboxId);
  if (allEntries.find((e) => e.path === fullPath)) {
    res.status(409).json({ success: false, error: 'Path already exists' });
    return;
  }

  const ok = createFileFs(sandboxId, fullPath, type as 'file' | 'directory');
  if (!ok) {
    res.status(500).json({ success: false, error: 'Failed to create' });
    return;
  }

  const updated = listAllFs(sandboxId);
  const entry = updated.find((e) => e.path === fullPath);
  const node = entry ? fsEntryToNode(sandboxId, entry) : null;

  res.status(201).json({ success: true, node });
});

router.post('/rename', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const access = checkSandboxAccess(req, res);
  if (!access) return;
  if (!requireEditPermission(access, res)) return;

  const { sandboxId } = access;
  const { oldPath, newPath } = req.body;

  if (!oldPath || !newPath) {
    res.status(400).json({ success: false, error: 'oldPath and newPath are required' });
    return;
  }

  const ok = renameInFs(sandboxId, oldPath, newPath);
  if (!ok) {
    res.status(500).json({ success: false, error: 'Failed to rename' });
    return;
  }

  res.json({ success: true });
});

router.delete('/', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const access = checkSandboxAccess(req, res);
  if (!access) return;
  if (!requireEditPermission(access, res)) return;

  const { sandboxId } = access;
  const filePath = req.query.path as string;

  if (!filePath || filePath === '/') {
    res.status(400).json({ success: false, error: 'Cannot delete root directory' });
    return;
  }

  const ok = deleteFromFs(sandboxId, filePath);
  if (!ok) {
    res.status(500).json({ success: false, error: 'Failed to delete' });
    return;
  }

  res.json({ success: true });
});

router.post('/snapshots', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const access = checkSandboxAccess(req, res);
  if (!access) return;
  if (!requireEditPermission(access, res)) return;

  const { sandboxId } = access;
  const { label } = req.body;

  if (!label) {
    res.status(400).json({ success: false, error: 'label is required' });
    return;
  }

  const snapshot = Snapshots.create({
    sandbox_id: sandboxId,
    label,
    tree_hash: '',
  });

  const ok = createSnapshotFs(sandboxId, snapshot.id);
  if (!ok) {
    Snapshots.delete(snapshot.id);
    res.status(500).json({ success: false, error: 'Failed to create snapshot' });
    return;
  }

  res.status(201).json({ success: true, snapshot });
});

router.post('/snapshots/:sid/rollback', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const access = checkSandboxAccess(req, res);
  if (!access) return;
  if (!requireEditPermission(access, res)) return;

  const { sandboxId } = access;
  const snapshotId = Number(req.params.sid);

  const snapshot = Snapshots.findById(snapshotId);
  if (!snapshot) {
    res.status(404).json({ success: false, error: 'Snapshot not found' });
    return;
  }

  if (snapshot.sandbox_id !== sandboxId) {
    res.status(400).json({ success: false, error: 'Snapshot does not belong to this sandbox' });
    return;
  }

  const ok = rollbackFromSnapshotFs(sandboxId, snapshotId);
  if (!ok) {
    res.status(500).json({ success: false, error: 'Failed to rollback to snapshot' });
    return;
  }

  res.json({ success: true });
});

router.delete('/snapshots/:sid', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const access = checkSandboxAccess(req, res);
  if (!access) return;
  if (!requireEditPermission(access, res)) return;

  const snapshotId = Number(req.params.sid);
  const snapshot = Snapshots.findById(snapshotId);

  if (snapshot) {
    deleteSnapshotFs(snapshotId);
    Snapshots.delete(snapshotId);
  }

  res.json({ success: true });
});

router.get('/snapshots', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const access = checkSandboxAccess(req, res);
  if (!access) return;

  const { sandboxId } = access;
  const snapshots = Snapshots.findBySandboxId(sandboxId);

  res.json({ success: true, snapshots });
});

export default router;
