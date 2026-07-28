export function PktSuiteIcon({ size = 32 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width={size} height={size}>
      <rect width="100" height="100" rx="22" fill="#1e1033"/>
      <path d="M50 40 L50 25" stroke="#a78bfa" strokeWidth="5.5" strokeLinecap="round"/>
      <path d="M58 57 L74 65" stroke="#a78bfa" strokeWidth="5.5" strokeLinecap="round"/>
      <path d="M42 57 L26 65" stroke="#a78bfa" strokeWidth="5.5" strokeLinecap="round"/>
      <circle cx="50" cy="18" r="7" fill="#a78bfa"/>
      <circle cx="80" cy="70" r="7" fill="#a78bfa"/>
      <circle cx="20" cy="70" r="7" fill="#a78bfa"/>
      <circle cx="50" cy="50" r="11" fill="#a78bfa"/>
    </svg>
  )
}

export function PktSuiteLockup({ height = 40 }: { height?: number }) {
  const scale = height / 64
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 172 64" height={height} width={172 * scale}>
      <defs><clipPath id="chub"><rect width="172" height="64" rx="12"/></clipPath></defs>
      <rect width="172" height="64" rx="12" fill="#111827"/>
      <rect width="64" height="64" fill="#1e1033" clipPath="url(#chub)"/>
      <g transform="scale(0.64)">
        <path d="M50 40 L50 25" stroke="#a78bfa" strokeWidth="5.5" strokeLinecap="round"/>
        <path d="M58 57 L74 65" stroke="#a78bfa" strokeWidth="5.5" strokeLinecap="round"/>
        <path d="M42 57 L26 65" stroke="#a78bfa" strokeWidth="5.5" strokeLinecap="round"/>
        <circle cx="50" cy="18" r="7" fill="#a78bfa"/>
        <circle cx="80" cy="70" r="7" fill="#a78bfa"/>
        <circle cx="20" cy="70" r="7" fill="#a78bfa"/>
        <circle cx="50" cy="50" r="11" fill="#a78bfa"/>
      </g>
      <text x="76" y="22" fontFamily="Courier New,Courier,monospace" fontSize="10" fill="#6b7280" letterSpacing="2">pkt</text>
      <text x="74" y="48" fontFamily="Courier New,Courier,monospace" fontSize="26" fontWeight="700" fill="white" letterSpacing="-1">HUB</text>
    </svg>
  )
}
