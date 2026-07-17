export function PktSuiteIcon({ size = 32 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width={size} height={size}>
      <rect width="100" height="100" rx="22" fill="#0a1628"/>
      <line x1="50" y1="5" x2="50" y2="95" stroke="white" strokeWidth="1.5" opacity="0.3"/>
      <line x1="5" y1="50" x2="95" y2="50" stroke="white" strokeWidth="1.5" opacity="0.3"/>
      <path d="M5 24h7l5.5-15.5 7 32 5.5-15.5h7" stroke="#60a5fa" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <rect x="53" y="19" width="7.5" height="7.5" rx="1.8" fill="#2dd4bf"/>
      <path d="M63.5 16.5 a10.5 10.5 0 0 1 0 13" stroke="#2dd4bf" strokeWidth="3.5" strokeLinecap="round" fill="none"/>
      <path d="M71 10 a19 19 0 0 1 0 25.5" stroke="#2dd4bf" strokeWidth="3.5" strokeLinecap="round" fill="none"/>
      <path d="M7 63h35M7 73h29M7 83h20" stroke="#4ade80" strokeWidth="3.5" strokeLinecap="round"/>
      <circle cx="72" cy="72" r="14" stroke="#a78bfa" strokeWidth="3.5" fill="none"/>
      <path d="M85 85l7.5 7.5" stroke="#a78bfa" strokeWidth="3.5" strokeLinecap="round"/>
    </svg>
  )
}

export function PktSuiteLockup({ height = 40 }: { height?: number }) {
  const scale = height / 80
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 258 80" height={height} width={258 * scale}>
      <defs><clipPath id="cs"><rect width="258" height="80" rx="14"/></clipPath></defs>
      <rect width="258" height="80" rx="14" fill="#111827"/>
      <rect width="84" height="80" fill="#0a1628" clipPath="url(#cs)"/>
      <g transform="translate(18,16)">
        <line x1="24" y1="2" x2="24" y2="46" stroke="white" strokeWidth="0.75" opacity="0.3"/>
        <line x1="2" y1="24" x2="46" y2="24" stroke="white" strokeWidth="0.75" opacity="0.3"/>
        <path d="M2.5 12h3.5l2.75-7.75 3.5 16 2.75-7.75h3.5" stroke="#60a5fa" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        <rect x="25.5" y="9.5" width="3.5" height="3.5" rx="0.75" fill="#2dd4bf"/>
        <path d="M30.5 7.8 a5 5 0 0 1 0 6.3" stroke="#2dd4bf" strokeWidth="1.75" strokeLinecap="round" fill="none"/>
        <path d="M34 5 a9 9 0 0 1 0 11.8" stroke="#2dd4bf" strokeWidth="1.75" strokeLinecap="round" fill="none"/>
        <path d="M3.5 30h17M3.5 35.5h14M3.5 41h9.5" stroke="#4ade80" strokeWidth="1.75" strokeLinecap="round"/>
        <circle cx="34.5" cy="35.5" r="7" stroke="#a78bfa" strokeWidth="1.75" fill="none"/>
        <path d="M41 42l3.5 3.5" stroke="#a78bfa" strokeWidth="1.75" strokeLinecap="round"/>
      </g>
      <text x="96" y="51" fontFamily="Courier New,Courier,monospace" fontSize="46" fontWeight="500" fill="white" letterSpacing="-2">pkt</text>
      <text x="188" y="27" fontFamily="Courier New,Courier,monospace" fontSize="13" fontWeight="700" fill="#60a5fa" letterSpacing="1.5">FLOW</text>
      <text x="188" y="43" fontFamily="Courier New,Courier,monospace" fontSize="13" fontWeight="700" fill="#2dd4bf" letterSpacing="1.5">SNMP</text>
      <text x="188" y="59" fontFamily="Courier New,Courier,monospace" fontSize="13" fontWeight="700" fill="#4ade80" letterSpacing="1.5">LOG</text>
      <text x="188" y="75" fontFamily="Courier New,Courier,monospace" fontSize="13" fontWeight="700" fill="#a78bfa" letterSpacing="1.5">PCAP</text>
    </svg>
  )
}
