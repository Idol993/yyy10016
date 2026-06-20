import type { Server } from 'http';
import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { URL } from 'url';
import jwt from 'jsonwebtoken';
import { spawn, type ChildProcess } from 'child_process';
import { Sandboxes, Collaborations } from '../db/store.js';
import { getActiveProcess, startSandbox } from '../services/sandbox.js';
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
import type { JwtPayload } from '../types.js';

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

function handleExecute(ws: WebSocket, sandboxId: number, payload: Record<string, unknown>): void {
  const command = payload.command as string;
  const args = (payload.args as string[]) || [];
  const cwd = payload.cwd as string | undefined;

  if (!command) {
    ws.send(JSON.stringify({ type: 'output', payload: { stream: 'stderr', data: 'No command specified\n', timestamp: Date.now() } }));
    return;
  }

  const sandbox = Sandboxes.findById(sandboxId);
  if (!sandbox) return;

  const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;
  const procInfo = getSandboxProcess(sandboxId);
  const room = getCollabRoom(sandboxId);

  try {
    const child = spawn('cmd', ['/c', fullCommand], {
      cwd: cwd || process.cwd(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    procInfo.process = child;

    child.stdout.on('data', (data: Buffer) => {
      const msg = {
        type: 'output',
        payload: { stream: 'stdout', data: data.toString(), timestamp: Date.now() },
      };
      for (const client of room.clients.keys()) {
        if (client.readyState === 1) {
          client.send(JSON.stringify(msg));
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      const msg = {
        type: 'output',
        payload: { stream: 'stderr', data: data.toString(), timestamp: Date.now() },
      };
      for (const client of room.clients.keys()) {
        if (client.readyState === 1) {
          client.send(JSON.stringify(msg));
        }
      }
    });

    child.on('close', (code) => {
      const msg = {
        type: 'output',
        payload: { stream: 'stdout', data: `\nProcess exited with code ${code}\n`, timestamp: Date.now() },
      };
      for (const client of room.clients.keys()) {
        if (client.readyState === 1) {
          client.send(JSON.stringify(msg));
        }
      }
      procInfo.process = null;
    });

    child.on('error', (err) => {
      const msg = {
        type: 'output',
        payload: { stream: 'stderr', data: `Error: ${err.message}\n`, timestamp: Date.now() },
      };
      for (const client of room.clients.keys()) {
        if (client.readyState === 1) {
          client.send(JSON.stringify(msg));
        }
      }
      procInfo.process = null;
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    ws.send(JSON.stringify({ type: 'output', payload: { stream: 'stderr', data: `Failed to execute: ${errorMsg}\n`, timestamp: Date.now() } }));
  }
}

function handleInput(sandboxId: number, payload: Record<string, unknown>): void {
  const procInfo = getSandboxProcess(sandboxId);
  if (procInfo.process && procInfo.process.stdin.writable) {
    const data = payload.data as string;
    procInfo.process.stdin.write(data);
  }
}

function handleResize(_sandboxId: number, _payload: Record<string, unknown>): void {
  // Terminal resize is handled client-side in xterm.js
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
    const isCollab = !!Collaborations.findBySandboxIdAndUserId(sandboxId, payload.userId);
    if (!isOwner && !isCollab) {
      ws.close(403, 'No access to this sandbox');
      return;
    }

    const permission: 'edit' | 'read' | 'owner' = isOwner ? 'owner' : (Collaborations.findBySandboxIdAndUserId(sandboxId, payload.userId)?.permission || 'read');

    const room = getCollabRoom(sandboxId);
    const user: CollabUser = addClientToRoom(sandboxId, ws, payload.userId, permission);

    const chatHistory = getChatHistory(room);
    if (chatHistory.length > 0) {
      ws.send(JSON.stringify({ type: 'chat_history', payload: { history: chatHistory } }));
    }

    const ydocState = getYDocState(room);
    if (ydocState.length > 0) {
      ws.send(JSON.stringify({ type: 'collab_init', payload: { update: Array.from(ydocState) } }));
    }

    const users = getRoomUsers(sandboxId);
    ws.send(JSON.stringify({ type: 'users', payload: { users } }));

    broadcastUserJoin(room, user, ws);

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as { type: string; payload: Record<string, unknown> };
        switch (message.type) {
          case 'execute':
            handleExecute(ws, sandboxId, message.payload);
            break;
          case 'input':
            handleInput(sandboxId, message.payload);
            break;
          case 'resize':
            handleResize(sandboxId, message.payload);
            break;
          case 'collab_edit': {
            const update = message.payload.update as number[];
            if (update) {
              const updateUint8 = new Uint8Array(update);
              handleCollabEdit(room, updateUint8, ws);
            }
            break;
          }
          case 'cursor':
            handleCursor(room, message.payload, payload.userId, ws);
            break;
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

      const procInfo = sandboxProcesses.get(sandboxId);
      if (room.clients.size === 0 && procInfo?.process) {
        procInfo.process.kill();
        procInfo.process = null;
      }
    });

    ws.send(JSON.stringify({ type: 'output', payload: { stream: 'stdout', data: `Connected to sandbox ${sandboxId}\n`, timestamp: Date.now() } }));
  });
}
