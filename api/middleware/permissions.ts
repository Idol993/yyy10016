import type { Response } from 'express';
import { Sandboxes, Collaborations } from '../db/store.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

export type PermissionLevel = 'read' | 'edit' | 'owner';

export interface SandboxAccess {
  hasAccess: boolean;
  permission: PermissionLevel;
  sandboxId: number;
  userId: number;
  error?: { status: number; message: string };
}

export function checkSandboxAccess(req: AuthenticatedRequest, res: Response): SandboxAccess | null {
  const sandboxId = Number(req.params.id);
  const userId = req.user!.userId;

  const sandbox = Sandboxes.findById(sandboxId);
  if (!sandbox) {
    res.status(404).json({ success: false, error: 'Sandbox not found' });
    return null;
  }

  if (sandbox.user_id === userId) {
    return { hasAccess: true, permission: 'owner', sandboxId, userId };
  }

  const collab = Collaborations.findBySandboxIdAndUserId(sandboxId, userId);
  if (collab) {
    return { hasAccess: true, permission: collab.permission as PermissionLevel, sandboxId, userId };
  }

  res.status(403).json({ success: false, error: 'No access to this sandbox' });
  return null;
}

export function requireEditPermission(access: SandboxAccess, res: Response): boolean {
  if (access.permission === 'read') {
    res.status(403).json({ success: false, error: 'Read-only members cannot modify content' });
    return false;
  }
  return true;
}

export function requireOwnerPermission(access: SandboxAccess, res: Response): boolean {
  if (access.permission !== 'owner') {
    res.status(403).json({ success: false, error: 'Only the owner can perform this action' });
    return false;
  }
  return true;
}
