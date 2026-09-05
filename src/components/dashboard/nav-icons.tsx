/** Minimal 20px line icons for the sidebar nav — same weight/size as the
 * dash-template's own NavItem icon slot (node 3896:138216), no icon-set
 * dependency. */
type IconProps = { className?: string };

export function OverviewIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="11" y="2.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="2.5" y="11" width="6.5" height="6.5" rx="1.5" />
      <rect x="11" y="11" width="6.5" height="6.5" rx="1.5" />
    </svg>
  );
}

export function PaymentsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M2.5 7.5h15M2.5 5.5A1.5 1.5 0 0 1 4 4h12a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5v-9Z" />
      <path d="M5 12h3" strokeLinecap="round" />
    </svg>
  );
}

export function SettlementsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M2.5 7 10 3l7.5 4" strokeLinejoin="round" />
      <path d="M4 8v6.5M8 8v6.5M12 8v6.5M16 8v6.5M2.5 16.5h15" strokeLinecap="round" />
    </svg>
  );
}

export function LinkIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path
        d="M8.5 11.5 11.5 8.5M7 12.5 4.6 10.1a2.5 2.5 0 0 1 0-3.54l1.06-1.06a2.5 2.5 0 0 1 3.54 0L11.6 7.9M13 7.5l2.4 2.4a2.5 2.5 0 0 1 0 3.54l-1.06 1.06a2.5 2.5 0 0 1-3.54 0L8.4 12.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DevelopersIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="m7 6-4 4 4 4M13 6l4 4-4 4M11.5 4.5l-3 11" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AgentIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path
        d="M10 2.5 11.4 7 16 8.4 11.4 9.8 10 14.3 8.6 9.8 4 8.4 8.6 7 10 2.5Z"
        strokeLinejoin="round"
      />
      <path d="M15 13.5 15.6 15.4 17.5 16 15.6 16.6 15 18.5 14.4 16.6 12.5 16 14.4 15.4 15 13.5Z" strokeLinejoin="round" />
    </svg>
  );
}
