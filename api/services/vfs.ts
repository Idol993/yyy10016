import crypto from 'crypto';
import { FileNodes, Snapshots } from '../db/store.js';
import type { FileNode, Snapshot } from '../types.js';

interface SnapshotData {
  snapshot: Snapshot;
  fileTree: FileNode[];
}

const snapshotStore = new Map<number, SnapshotData>();

export function createSnapshot(sandboxId: number, label: string): Snapshot | null {
  const files = FileNodes.cloneForSnapshot(sandboxId);
  if (files.length === 0) return null;

  const treeData = files
    .map((f) => `${f.path}:${f.type}:${f.content || ''}`)
    .join('|');
  const treeHash = crypto.createHash('sha256').update(treeData).digest('hex');

  const snapshot = Snapshots.create({
    sandbox_id: sandboxId,
    label,
    tree_hash: treeHash,
  });

  snapshotStore.set(snapshot.id, {
    snapshot,
    fileTree: JSON.parse(JSON.stringify(files)),
  });

  return snapshot;
}

export function rollbackToSnapshot(sandboxId: number, snapshotId: number): boolean {
  const snapshot = Snapshots.findById(snapshotId);
  if (!snapshot || snapshot.sandbox_id !== sandboxId) return false;

  const data = snapshotStore.get(snapshotId);
  if (!data) return false;

  FileNodes.replaceFromSnapshot(sandboxId, data.fileTree);
  return true;
}

export function listSnapshots(sandboxId: number): Snapshot[] {
  return Snapshots.findBySandboxId(sandboxId);
}

export function getSnapshotData(snapshotId: number): FileNode[] | null {
  const data = snapshotStore.get(snapshotId);
  return data ? data.fileTree : null;
}

export function syncFiles9P(sandboxId: number, operations: Array<{ op: string; path: string; content?: string }>): boolean {
  for (const operation of operations) {
    switch (operation.op) {
      case 'create': {
        const parts = operation.path.split('/');
        const name = parts[parts.length - 1] || operation.path;
        FileNodes.create({
          sandbox_id: sandboxId,
          path: operation.path,
          name,
          type: 'file',
          content: operation.content || '',
        });
        break;
      }
      case 'delete': {
        FileNodes.deleteByPath(sandboxId, operation.path);
        break;
      }
      case 'update': {
        const existing = FileNodes.findBySandboxIdAndPath(sandboxId, operation.path);
        if (existing) {
          FileNodes.update(existing.id, { content: operation.content || '' });
        }
        break;
      }
      default:
        break;
    }
  }
  return true;
}
