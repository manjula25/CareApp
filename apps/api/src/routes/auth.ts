import { Router } from 'express';
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { signToken, Role } from '../auth/jwt';
import { requireAuth } from '../middleware/auth';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: Role;
}

/**
 * S12 A.2 — `GET /api/auth/me` returns the full user row from the DB (the JWT
 * payload only carries `id`/`name`/`role`; this returns `email` and the
 * `initials` the Header dropdown avatar wants). `requireAuth` only on /me —
 * /login must remain unauthenticated. `initials` is computed from `name`
 * rather than stored as a column (matches AppShell.tsx:18-24's client-side
 * helper, keeps the migration footprint to zero).
 */
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

  router.get('/me', requireAuth, (req, res) => {
    const jwtUser = req.auth;
    if (!jwtUser) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const row = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(jwtUser.id) as
      | { id: string; name: string; email: string; role: Role }
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const initials = row.name
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();

    res.json({ id: row.id, name: row.name, email: row.email, role: row.role, initials });
  });

  return router;
}