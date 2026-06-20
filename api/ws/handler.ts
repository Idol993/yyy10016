import type { Server } from 'http';
import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { URL } from 'url';
import jwt from 'jsonwebtoken';
import { Sandboxes, Collaborations } from '../db/store.js';
import type { JwtPayload } from '../types.js';
import {
  getCollabRoom,
  addClientToRoom,
  removeClientFromRoom,
  handleCollabEdit,
  handleCursor,
  handleChat,
  broadcastUserJoin,
  broadcastUserLeave,
  getChatHistory,
  getYDocState,
  getRoomUsers,
  type CollabUser,
} from '../services/collab.js';
import { startSandbox, stopSandbox } from '../services/sandbox.js';
import {
  runEntryFile,
  killRunningSandbox,
  getRunningInstance,
  writeToRunningInstance,
  getRuntimeMeta,
  type ExecContext,
  type ExecCallbacks,
} from '../services/executor.js';

const JWT_SECRET = process.env.JWT_SECRET || 'sandboxos-dev-secret';

function verifyWsToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

function sendToAll(room: ReturnType<typeof getCollabRoom>, msg: unknown): void {
  for (const client of room.clients.keys()) {
    if (client.readyState === 1) {
      client.send(JSON.stringify(msg));
    }
  }
}

function buildExecContext(
  sandbox: { id: number; language: string; cpu_limit_percent: number; memory_limit_mb: number; disk_limit_mb: number },
  userId: number,
  username: string,
  permission: 'read' | 'edit' | 'owner'
): ExecContext {
  return {
    sandboxId: sandbox.id,
    userId,
    username,
    permission,
    language: sandbox.language,
    cpuLimitPercent: sandbox.cpu_limit_percent,
    memoryLimitMb: sandbox.memory_limit_mb,
    diskLimitMb: sandbox.disk_limit_mb,
  };
}

function createCallbacks(room: ReturnType<typeof getCollabRoom>): ExecCallbacks {
  return {
    onOutput: (stream, data) => {
      const msg = {
        type: 'output',
        payload: { stream, data, timestamp: Date.now() },
      };
      sendToAll(room, msg);
    },
    onExit: (code, reason) => {
      const reasonText = reason ? ` (reason: ${reason})` : '';
      const msg = {
        type: 'output',
        payload: { stream: 'system' as const, data: `\n[SandboxOS] Instance exited with code ${code}${reasonText}\n`, timestamp: Date.now() },
      };
      sendToAll(room, msg);
    },
    onError: (err) => {
      const msg = {
        type: 'output',
        payload: { stream: 'stderr' as const, data: `[SandboxOS] Error: ${err.message}\n`, timestamp: Date.now() },
      };
      sendToAll(room, msg);
    },
  };
}

export function setupWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);

    if (!url.pathname.startsWith('/ws/sandbox/')) {
      ws.close(4000, 'Invalid endpoint');
      return;
    }

    const token = url.searchParams.get('token');
    const sandboxIdStr = url.pathname.match(/\/sandbox\/(\d+)/)?.[1];

    if (!token || !sandboxIdStr) {
      ws.close(4001, 'Missing token or sandbox id');
      return;
    }

    const payload = verifyWsToken(token);
    if (!payload) {
      ws.close(4003, 'Invalid token');
      return;
    }

    const sandboxId = Number(sandboxIdStr);
    const sandbox = Sandboxes.findById(sandboxId);
    if (!sandbox) {
      ws.close(4004, 'Sandbox not found');
      return;
    }

    const isOwner = sandbox.user_id === payload.userId;
    const collabEntry = Collaborations.findBySandboxIdAndUserId(sandboxId, payload.userId);
    const isCollab = !!collabEntry;
    if (!isOwner && !isCollab) {
      ws.close(403, 'No access to this sandbox');
      return;
    }

    const permission: 'edit' | 'read' | 'owner' = isOwner
      ? 'owner'
      : (collabEntry?.permission || 'read') as 'edit' | 'read';

    startSandbox(sandboxId).catch(() => { /* ignore */ });

    const room = getCollabRoom(sandboxId);
    const user: CollabUser = addClientToRoom(sandboxId, ws, payload.userId, permission);
    const execCtx = buildExecContext(sandbox, payload.userId, payload.email || 'user', permission);

    const chatHistory = getChatHistory(room);
    if (chatHistory.length > 0) {
      ws.send(JSON.stringify({ type: 'chat_history', payload: { history: chatHistory } }));
    }

    const ydocState = getYDocState(room);
    if (ydocState.length > 0) {
      ws.send(JSON.stringify({ type: 'collab_init', payload: { update: Array.from(ydocState) } }));
    }

    const users = getRoomUsers(sandboxId);
    sendToAll(room, { type: 'users', payload: { users } });

    broadcastUserJoin(room, user);

    (async () => {
      try {
        const rt = await getRuntimeMeta();
        const runningInstance = getRunningInstance(sandboxId);
        ws.send(JSON.stringify({
          type: 'output',
          payload: {
            stream: 'system',
            data: `[SandboxOS] Connected. Runtime: ${rt.type} v${rt.version}. Permission: ${permission}. ` +
              (runningInstance ? `Active instance: ${runningInstance.id}` : `Sandbox ready. Click Run to start isolated instance.`) + '\n',
            timestamp: Date.now(),
          },
        }));
      } catch {
        const runningInstance = getRunningInstance(sandboxId);
        ws.send(JSON.stringify({
          type: 'output',
          payload: {
            stream: 'system',
            data: `[SandboxOS] Connected. Permission: ${permission}. ` +
              (runningInstance ? `Active instance: ${runningInstance.id}` : `Sandbox ready. Click Run to start isolated instance.`) + '\n',
            timestamp: Date.now(),
          },
        }));
      }
    })();

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as { type: string; payload: Record<string, unknown> };

        switch (message.type) {
          case 'execute':
          case 'run': {
            if (permission === 'read') {
              ws.send(JSON.stringify({
                type: 'output',
                payload: { stream: 'stderr', data: '[SandboxOS] Read-only members cannot execute code\n', timestamp: Date.now() },
              }));
              break;
            }
            const callbacks = createCallbacks(room);
            const existing = getRunningInstance(sandboxId);
            if (existing && existing.status === 'running') {
              callbacks.onOutput('system', '[SandboxOS] Stopping previous isolated instance...\n');
              killRunningSandbox(sandboxId);
              setTimeout(async () => {
                callbacks.onOutput('system', '[SandboxOS] Launching isolated instance...\n');
                const result = await runEntryFile(execCtx, callbacks);
                if (result.error) {
                  callbacks.onOutput('stderr', `[SandboxOS] ${result.error}\n`);
                }
              }, 500);
            } else {
              callbacks.onOutput('system', '[SandboxOS] Launching isolated instance...\n');
              (async () => {
                const result = await runEntryFile(execCtx, callbacks);
                if (result.error) {
                  callbacks.onOutput('stderr', `[SandboxOS] ${result.error}\n`);
                }
              })();
            }
            break;
          }
          case 'stop': {
            if (permission === 'read') break;
            const ok = killRunningSandbox(sandboxId);
            const callbacks = createCallbacks(room);
            callbacks.onOutput('system', ok ? '[SandboxOS] Isolated instance stopped by user.\n' : '[SandboxOS] No running instance.\n');
            break;
          }
          case 'input': {
            if (permission === 'read') {
              ws.send(JSON.stringify({
                type: 'output',
                payload: { stream: 'stderr', data: '[SandboxOS] Read-only members cannot send input\n', timestamp: Date.now() },
              }));
              break;
            }
            const inputData = message.payload.data as string;
            const ok = writeToRunningInstance(sandboxId, inputData);
            if (!ok) {
              ws.send(JSON.stringify({
                type: 'output',
                payload: { stream: 'stderr', data: '[SandboxOS] No running instance to receive input\n', timestamp: Date.now() },
              }));
            }
            break;
          }
          case 'resize':
            break;
          case 'collab_edit': {
            if (permission === 'read') break;
            const update = message.payload.update as number[];
            if (update) {
              const updateUint8 = new Uint8Array(update);
              handleCollabEdit(room, updateUint8, ws);
            }
            break;
          }
          case 'cursor': {
            if (permission === 'read') break;
            handleCursor(room, message.payload, payload.userId, ws);
            break;
          }
          case 'chat': {
            const msgText = message.payload.message as string;
            handleChat(room, msgText, payload.userId, ws);
            break;
          }
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      broadcastUserLeave(room, payload.userId);
      removeClientFromRoom(sandboxId, ws);

      if (room.clients.size === 0) {
        try {
          killRunningSandbox(sandboxId);
        } catch { /* ignore */ }
        stopSandbox(sandboxId).catch(() => { /* ignore */ });
      }

      const usersAfter = getRoomUsers(sandboxId);
      sendToAll(room, { type: 'users', payload: { users: usersAfter } });
    });
  });
}
