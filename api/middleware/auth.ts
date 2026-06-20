import { type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from '../types.js';

const JWT_SECRET = process.env.JWT_SECRET || 'sandboxos-dev-secret';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'No token provided' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}
