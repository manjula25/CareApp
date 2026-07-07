import clsx from 'clsx';
import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export function Card({ children, className, onClick }: CardProps) {
  return (
    <div
      className={clsx(
        'bg-surface border border-border rounded-xl p-4',
        onClick && 'cursor-pointer hover:bg-surface-hover transition-colors',
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
