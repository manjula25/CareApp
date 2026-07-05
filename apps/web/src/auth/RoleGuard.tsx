import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, roleHome, type Role } from './useAuth';

export function RoleGuard({ children, role }: { children: ReactNode; role?: Role }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={roleHome(user.role)} replace />;
  return <>{children}</>;
}
