import { Router } from 'express';
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { signToken, Role } from '../auth/jwt';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: Role;
}

export function createAuthRouter(db: Database.Database): Router {
  const router = Router();

  router.post('/login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signToken({ id: user.id, name: user.name, role: user.role });
    res.json({ token });
  });

  return router;
}
