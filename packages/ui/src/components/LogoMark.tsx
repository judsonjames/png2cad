/** The mark: a pixel stair resolving into a clean curve. Decorative, so hidden from screen readers. */
export function LogoMark() {
  return (
    <svg className="p2c-logo-mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <path fill="var(--muted)" d="M4 28V18h5v-5h5V8h5V4h3v7h-5v5h-5v5H7v7z" />
      <path fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" d="M7 28C7 15 15 7 28 7" />
    </svg>
  );
}
