import * as Y from 'yjs';
import type { WebSocket } from 'ws';
import { Users } from '../db/store.js';

const USER_COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#96CEB4',
  '#FFEAA7',
  '#DDA0DD',
  '#98D8C8',
  '#F7DC6F',
  '#BB8FCE',
  '#85C1E9',
];

export interface CollabUser {
  id: number;
  username: string;
  color: string;
  permission: 'edit' | 'read' | 'owner';
  cursor?: {
    path: string;
    line: number;
    column: number;
  };
}

export interface CollabRoom {
  sandboxId: number;
  ydoc: Y.Doc;
  clients: Map<WebSocket, CollabUser>;
  chatHistory: Array<{
    userId: number;
    username: string;
    message: string;
    timestamp: number;
  }>;
}

const rooms = new Map<number, CollabRoom>();

function getColorForUser(userId: number): string {
  return USER_COLORS[userId % USER_COLORS.length];
}

export function getCollabRoom(sandboxId: number): CollabRoom {
  if (!rooms.has(sandboxId)) {
    const ydoc = new Y.Doc();
    rooms.set(sandboxId, {
      sandboxId,
      ydoc,
      clients: new Map(),
      chatHistory: [],
    });
  }
  return rooms.get(sandboxId)!;
}

export function addClientToRoom(
  sandboxId: number,
  ws: WebSocket,
  userId: number,
  permission: 'edit' | 'read' | 'owner'
): CollabUser {
  const room = getCollabRoom(sandboxId);
  const userRecord = Users.findById(userId);
  const color = getColorForUser(userId);

  const user: CollabUser = {
    id: userId,
    username: userRecord?.username || `user_${userId}`,
    color,
    permission,
  };

  room.clients.set(ws, user);
  return user;
}

export function removeClientFromRoom(sandboxId: number, ws: WebSocket): void {
  const room = rooms.get(sandboxId);
  if (room) {
    room.clients.delete(ws);
    if (room.clients.size === 0) {
      room.ydoc.destroy();
      rooms.delete(sandboxId);
    }
  }
}

export function getRoomUsers(sandboxId: number): CollabUser[] {
  const room = rooms.get(sandboxId);
  if (!room) return [];
  return Array.from(room.clients.values());
}

export function broadcastToRoom(
  room: CollabRoom,
  message: Record<string, unknown>,
  exclude?: WebSocket
): void {
  const data = JSON.stringify(message);
  for (const client of room.clients.keys()) {
    if (client !== exclude && client.readyState === 1) {
      client.send(data);
    }
  }
}

export function handleCollabEdit(room: CollabRoom, update: Uint8Array, sender: WebSocket): void {
  Y.applyUpdate(room.ydoc, update);
  const msg = {
    type: 'collab_edit',
    payload: { update: Array.from(update) },
  };
  broadcastToRoom(room, msg, sender);
}

export function handleCursor(
  room: CollabRoom,
  payload: Record<string, unknown>,
  userId: number,
  sender: WebSocket
): void {
  const user = room.clients.get(sender);
  if (user) {
    user.cursor = {
      path: (payload.path as string) || '',
      line: (payload.line as number) || 1,
      column: (payload.column as number) || 1,
    };
  }
  const msg = {
    type: 'cursor',
    payload: { userId, ...payload },
  };
  broadcastToRoom(room, msg, sender);
}

export function handleChat(
  room: CollabRoom,
  message: string,
  userId: number,
  sender: WebSocket
): void {
  if (!message) return;

  const user = room.clients.get(sender);
  const username = user?.username || `user_${userId}`;

  const chatEntry = {
    userId,
    username,
    message,
    timestamp: Date.now(),
  };
  room.chatHistory.push(chatEntry);

  const msg = {
    type: 'chat',
    payload: chatEntry,
  };
  broadcastToRoom(room, msg);
}

export function broadcastUserJoin(room: CollabRoom, user: CollabUser, exclude?: WebSocket): void {
  const msg = {
    type: 'user_join',
    payload: { user },
  };
  broadcastToRoom(room, msg, exclude);
}

export function broadcastUserLeave(room: CollabRoom, userId: number): void {
  const msg = {
    type: 'user_leave',
    payload: { userId },
  };
  broadcastToRoom(room, msg);
}

export function getChatHistory(
  room: CollabRoom
): Array<{ userId: number; username: string; message: string; timestamp: number }> {
  return room.chatHistory;
}

export function getYDocState(room: CollabRoom): Uint8Array {
  return Y.encodeStateAsUpdate(room.ydoc);
}
