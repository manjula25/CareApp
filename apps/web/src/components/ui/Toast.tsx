import { useState, useEffect } from 'react';
import clsx from 'clsx';

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  onClose: () => void;
  duration?: number;
}

const typeClasses = {
  success: 'bg-emerald-dim border-emerald/30 text-emerald',
  error: 'bg-red-dim border-red/30 text-red',
  info: 'bg-cyan-dim border-cyan/30 text-cyan',
};

export function Toast({ message, type = 'info', onClose, duration = 3000 }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div
      className={clsx(
        'fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium transition-opacity duration-300',
        typeClasses[type],
        visible ? 'opacity-100' : 'opacity-0'
      )}
    >
      {message}
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100">
        ✕
      </button>
    </div>
  );
}
