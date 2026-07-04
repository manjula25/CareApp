import jwt from 'jsonwebtoken';

export type Role = 'director' | 'coordinator' | 'social_worker';

export interface AuthTokenPayload {
  id: string;
  name: string;
  role: Role;
}

const JWT_SECRET = process.env.JWT_SECRET ?? 'caresync-dev-secret-do-not-use-in-production';

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
}
