import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';

const ROLE_LABELS: Record<string, string> = {
  director: 'Care Director',
  coordinator: 'Care Coordinator',
  social_worker: 'Social Worker',
};

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <header
      className="flex items-center justify-between px-4 bg-surface border-b border-border"
      style={{ height: 48, minHeight: 48 }}
    >
      {/* Left: Logo */}
      <div className="flex items-center gap-2">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00C8FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        <span className="text-text-muted font-medium text-sm">CareSync</span>
        <span className="text-cyan font-bold text-sm">AI</span>
      </div>

      {/* Center: Compliance badges */}
      <div className="hidden md:flex items-center gap-2">
        {['FHIR R4', 'SMART on FHIR', 'CDS Hooks'].map((label) => (
          <span
            key={label}
            className="bg-surface-raised border border-border text-text-muted text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
          >
            {label}
          </span>
        ))}
      </div>

      {/* Right: sync, bell, avatar */}
      <div className="flex items-center gap-3">
        <span className="text-text-dim text-xs hidden sm:block">Last synced 42s ago</span>

        {/* Bell */}
        <div className="relative cursor-pointer" onClick={() => navigate('/alerts')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5A8FAA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red rounded-full text-[8px] flex items-center justify-center text-white font-bold">
            3
          </span>
        </div>

        {/* Avatar + dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((o) => !o)}
            className="w-7 h-7 bg-surface-raised border border-border rounded-full flex items-center justify-center text-text-muted text-[10px] font-bold hover:border-cyan/40 transition-colors"
          >
            {user ? initials(user.name) : 'CS'}
          </button>

          {dropdownOpen && (
            <div
              className="absolute right-0 top-full mt-2 w-52 bg-surface border border-border rounded-xl shadow-2xl z-50 overflow-hidden"
              style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
            >
              {/* User info */}
              <div className="px-4 py-3 border-b border-border">
                <div className="text-text text-sm font-semibold truncate">{user?.name ?? 'User'}</div>
                {user?.role && (
                  <span className="inline-block mt-1.5 text-[10px] font-semibold px-2 py-0.5 rounded"
                    style={{ background: 'rgba(0,200,255,0.1)', color: '#00C8FF' }}>
                    {ROLE_LABELS[user.role] ?? user.role}
                  </span>
                )}
              </div>

              {/* Menu items */}
              <div className="py-1">
                <button
                  onClick={() => { setDropdownOpen(false); navigate('/settings'); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-muted hover:bg-surface-raised hover:text-text transition-colors text-left"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  Settings
                </button>
                <div className="my-1 border-t border-border" />
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-red/5 transition-colors text-left"
                  style={{ color: '#E84848' }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
