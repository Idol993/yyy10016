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
import { setActiveProcess, startSandbox } from '../services/sandbox.js';
import {
  executeInSandbox,
  runEntryFile,
  runCustomCommand,
  sendToProcess,
  type ExecContext,
  type ExecCallbacks,
} from '../services/executor.js';
import type { ChildProcess } from 'child_process';

const JWT_SECRET = process.env.JWT_SECRET || 'sandboxos-dev-secret';

interface SandboxProcesses {
  process: ChildProcess | null;
}

const sandboxProcesses = new Map<number, SandboxProcesses>();

function verifyWsToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

function getSandboxProcess(sandboxId: number): SandboxProcesses {
  if (!sandboxProcesses.has(sandboxId)) {
    sandboxProcesses.set(sandboxId, { process: null });
  }
  return sandboxProcesses.get(sandboxId)!;
}

function sendToAll(room: ReturnType<typeof getCollabRoom>, msg: unknown): void {
  for (const client of room.clients.keys()) {
    if (client.readyState === 1) {
      client.send(JSON.stringify(msg));
    }
  }
}

function buildExecContext(
  sandboxId: number,
  userId: number,
  username: string,
  permission: 'read' | 'edit' | 'owner'
): ExecContext {
  return { sandboxId, userId, username, permission };
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
    onExit: (code) => {
      const msg = {
        type: 'output',
        payload: { stream: 'system' as const, data: `\n[SandboxOS] Process exited with code ${code}\n`, timestamp: Date.now() },
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
    const procInfo = getSandboxProcess(sandboxId);
    const execCtx = buildExecContext(sandboxId, payload.userId, payload.email || 'user', permission);

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

    ws.send(JSON.stringify({
      type: 'output',
      payload: {
        stream: 'system',
        data: `[SandboxOS] Connected. Your permission: ${permission}. Isolated environment ready.\n`,
        timestamp: Date.now(),
      },
    }));

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as { type: string; payload: Record<string, unknown> };

        switch (message.type) {
          case 'execute': {
            if (permission === 'read') {
              ws.send(JSON.stringify({
                type: 'output',
                payload: { stream: 'stderr', data: '[SandboxOS] Read-only members cannot execute commands\n', timestamp: Date.now() },
              }));
              break;
            }
            const command = message.payload.command as string;
            const args = (message.payload.args as string[]) || [];
            const callbacks = createCallbacks(room);

            if (command === '__run_entry__') {
              const result = runEntryFile(execCtx, sandbox.language, callbacks);
              if (result.error) {
                callbacks.onOutput('stderr', `[SandboxOS] ${result.error}\n`);
              } else if (result.process) {
                procInfo.process = result.process;
                setActiveProcess(sandboxId, result.process);
              }
            } else if (command) {
              const result = runCustomCommand(execCtx, command, args, callbacks);
              if (result.error) {
                callbacks.onOutput('stderr', `[SandboxOS] ${result.error}\n`);
              } else if (result.process) {
                procInfo.process = result.process;
                setActiveProcess(sandboxId, result.process);
              }
            }
            break;
          }
          case 'run': {
            if (permission === 'read') {
              ws.send(JSON.stringify({
                type: 'output',
                payload: { stream: 'stderr', data: '[SandboxOS] Read-only members cannot execute code\n', timestamp: Date.now() },
              }));
              break;
            }
            const callbacks = createCallbacks(room);
            const result = runEntryFile(execCtx, sandbox.language, callbacks);
            if (result.error) {
              callbacks.onOutput('stderr', `[SandboxOS] ${result.error}\n`);
            } else if (result.process) {
              procInfo.process = result.process;
              setActiveProcess(sandboxId, result.process);
            }
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
            sendToProcess(procInfo.process, inputData);
            break;
          }
          case 'resize':
            break;
          case 'collab_edit': {
            if (permission === 'read') {
              break;
            }
            const update = message.payload.update as number[];
            if (update) {
              const updateUint8 = new Uint8Array(update);
              handleCollabEdit(room, updateUint8, ws);
            }
            break;
          }
          case 'cursor': {
            if (permission === 'read') {
              break;
            }
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

      const procInfoCached = sandboxProcesses.get(sandboxId);
      if (room.clients.size === 0 && procInfoCached?.process) {
        try {
          procInfoCached.process.kill();
        } catch { /* ignore */ }
        procInfoCached.process = null;
      }

      const usersAfter = getRoomUsers(sandboxId);
      sendToAll(room, { type: 'users', payload: { users: usersAfter } });
    });
  });
}
