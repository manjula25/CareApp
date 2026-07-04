// Logo, bell, and filter icons are copied from the reference mockup's inline
// SVGs (reference-materials/caresync-ai.html) — same paths, same viewBoxes.

export function LogoIcon({ className }: { className?: string }) {
  return (
    <svg width="26" height="18" viewBox="0 0 26 18" fill="none" className={className} aria-hidden="true">
      <path
        d="M1 9h5l2.5-6 4 12 3-8 1.5 2H25"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BellIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="17" viewBox="0 0 16 17" fill="none" className={className} aria-hidden="true">
      <path
        d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5v3L2 12h12l-1.5-3V6A4.5 4.5 0 0 0 8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M6.5 14.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function FilterIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="13" viewBox="0 0 14 13" fill="none" className={className} aria-hidden="true">
      <path
        d="M1 1.5h12L8.5 7v4.2L5.5 12V7L1 1.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M15 17l5-5-5-5M20 12H9M12 19H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
