// icons.tsx
// Inline SVG, not glyphs.
//
// Ballast ships no webfont on purpose (so `font-src 'self'` in the CSP stays
// absolute). The consequence is that we cannot rely on any character outside the
// basic set being drawable: ♡ and ▨ render as tofu boxes on a system stack with
// no symbol coverage, which is exactly what happened the first time round.
//
// An icon that renders as an empty rectangle on someone's machine is worse than
// no icon. SVG depends on no font, no CDN, and no CSP exception, and looks
// identical everywhere. Use these; don't reach for a Unicode symbol.

type Props = { size?: number; className?: string };

export function Heart({ size = 15, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l8.8 8.8 8.8-8.8a5 5 0 0 0 0-7.1z" />
    </svg>
  );
}

export function Receipt({ size = 13, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* A torn-off till receipt: the zigzag bottom edge is what makes it read. */}
      <path d="M4 2h16v20l-2.7-1.6L14.7 22 12 20.4 9.3 22l-2.6-1.6L4 22z" />
      <path d="M8 7h8M8 11h8M8 15h5" />
    </svg>
  );
}

export function Refresh({ size = 13, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}
