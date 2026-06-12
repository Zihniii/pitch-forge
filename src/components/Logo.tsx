/**
 * PitchForge mark — an anvil (the Forge) emitting pitch waves from its horn,
 * with an ember spark. Reinforces the name and the "voice forged under
 * pressure" idea. Transparent background; meant to sit on the dark UI.
 */
export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="pfMark" x1="3" y1="6" x2="28" y2="26" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FBC25A" />
          <stop offset="1" stopColor="#E8841A" />
        </linearGradient>
      </defs>

      {/* pitch waves from the horn */}
      <g stroke="url(#pfMark)" strokeWidth="1.6" strokeLinecap="round" fill="none">
        <path d="M5.2 13.4 A 3 3 0 0 0 5.2 18.6" opacity="0.9" />
        <path d="M3.3 12 A 4.9 4.9 0 0 0 3.3 20" opacity="0.5" />
      </g>

      {/* anvil top + horn */}
      <path
        d="M6.6 16 L11 13.4 H24.4 a1.6 1.6 0 0 1 1.6 1.6 V16.4 a1.6 1.6 0 0 1 -1.6 1.6 H11 Z"
        fill="url(#pfMark)"
      />
      {/* anvil waist + base */}
      <path d="M14 18 H21.6 L20.3 21.8 H22.7 V24.4 H13 V21.8 H15.4 Z" fill="url(#pfMark)" />

      {/* ember spark */}
      <path
        d="M24.7 8 L25.4 9.9 L27.3 10.6 L25.4 11.3 L24.7 13.2 L24 11.3 L22.1 10.6 L24 9.9 Z"
        fill="#FFD27A"
      />
    </svg>
  );
}
