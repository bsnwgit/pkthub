/**
 * Brand — pktHUB identity in the Foundation visual language.
 *
 * The functional idea of the original mark is preserved: the diagram still
 * says the same thing about what this app does. Only the execution changes —
 * hairline strokes and a concentric survey ring instead of filled shapes,
 * gold as the system channel, and a single ice-blue element marking the
 * live/data part of the diagram.
 */

export function BrandMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
  <circle cx="32" cy="32" r="30" stroke="rgba(216,180,110,.16)"/>
  <circle cx="32" cy="32" r="30" stroke="rgba(216,180,110,.5)" strokeDasharray="1.5 11"/>
  <path d="M32 25 V17" stroke="rgba(216,180,110,.85)" strokeWidth="1.2"/>
  <path d="M36.5 38.5 L45 44" stroke="rgba(216,180,110,.85)" strokeWidth="1.2"/>
  <path d="M27.5 38.5 L19 44" stroke="rgba(138,216,234,.55)" strokeWidth="1.2"/>
  <circle cx="32" cy="32" r="11.5" stroke="rgba(216,180,110,.24)"/>
  <circle cx="32" cy="32" r="7" stroke="#f5e2b6" strokeWidth="1.3"/>
  <circle cx="32" cy="32" r="2.4" fill="#f5e2b6"/>
  <circle cx="32" cy="14" r="3.4" stroke="rgba(216,180,110,.85)"/>
  <circle cx="48" cy="46" r="3.4" stroke="rgba(216,180,110,.85)"/>
  <circle cx="16" cy="46" r="3.4" stroke="#8ad8ea"/>
  <circle cx="16" cy="46" r="1.1" fill="#8ad8ea"/>
    </svg>
  )
}

/** Full lockup — mark + wordmark. Pass descriptor={null} for tight spots. */
export function BrandLockup({
  markSize = 30,
  className = '',
  descriptor = 'NOC Command',
}: {
  markSize?: number
  className?: string
  descriptor?: string | null
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <BrandMark size={markSize} className="flex-none" />
      <div className="leading-tight min-w-0">
        <div className="flex items-baseline gap-[3px]">
          <span className="font-mono text-[10px] text-gray-400" style={{ letterSpacing: '0.26em' }}>
            pkt
          </span>
          <span className="font-mono text-blue-300" style={{ fontSize: '15px', letterSpacing: '0.2em' }}>
            HUB
          </span>
        </div>
        {descriptor && (
          <div className="f-lbl mt-[3px]" style={{ letterSpacing: '0.32em' }}>
            {descriptor}
          </div>
        )}
      </div>
    </div>
  )
}

export default BrandLockup
