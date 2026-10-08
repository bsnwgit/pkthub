/**
 * Suite logo — kept as a thin wrapper over the shared Foundation Brand mark
 * so every existing call site (PktSuiteIcon / PktSuiteLockup) keeps working
 * while the artwork itself comes from one place.
 */
import { BrandMark, BrandLockup } from './Brand'

export function PktSuiteIcon({ size = 32 }: { size?: number }) {
  return <BrandMark size={size} />
}

export function PktSuiteLockup({ height = 40 }: { height?: number }) {
  // The lockup's mark reads best at roughly three-quarters of the band height.
  return <BrandLockup markSize={Math.round(height * 0.72)} />
}

export default PktSuiteLockup
