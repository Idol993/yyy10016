import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { Users } from '../db/store.js';
import { authMiddleware, generateToken, type AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

router.post('/register', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { email, password, username } = req.body;

  if (!email || !password || !username) {
    res.status(400).json({ success: false, error: 'email, password and username are required' });
    return;
  }

  const existingEmail = Users.findByEmail(email);
  if (existingEmail) {
    res.status(409).json({ success: false, error: 'Email already registered' });
    return;
  }

  const existingUsername = Users.findByUsername(username);
  if (existingUsername) {
    res.status(409).json({ success: false, error: 'Username already taken' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = Users.create({
    email,
    username,
    password_hash: passwordHash,
    role: 'user',
    storage_limit_mb: 500,
    sandbox_limit: 3,
  });

  const token = generateToken({ userId: user.id, email: user.email, role: user.role });

  res.status(201).json({
    success: true,
    token,
    user: { id: user.id, email: user.email, username: user.username, role: user.role },
  });
});

router.post('/login', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ success: false, error: 'email and password are required' });
    return;
  }

  const user = Users.findByEmail(email);
  if (!user) {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
    return;
  }

  const token = generateToken({ userId: user.id, email: user.email, role: user.role });

  res.json({
    success: true,
    token,
    user: { id: user.id, email: user.email, username: user.username, role: user.role },
  });
});

router.get('/me', authMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const user = Users.findById(req.user!.userId);
  if (!user) {
    res.status(404).json({ success: false, error: 'User not found' });
    return;
  }

  res.json({
    success: true,
    user: { id: user.id, email: user.email, username: user.username, role: user.role, storage_limit_mb: user.storage_limit_mb, sandbox_limit: user.sandbox_limit },
  });
});

export default router;
