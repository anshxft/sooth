// Loading states, drawn with thinking-orbs (a dotted orb on a 2D canvas; follows the theme and
// renders a still frame for reduced motion).
import { ThinkingOrb } from 'thinking-orbs'
import { cn } from './utils'

/** Fills the page area while a section's code arrives, so the footer never jumps up alone. */
export function PageLoader() {
  return (
    <div role="status" className="grid min-h-[calc(100svh-6rem)] place-items-center">
      <div className="flex flex-col items-center gap-4">
        <ThinkingOrb state="connecting" size={64} aria-label="Loading" />
        <span className="label text-muted">Loading</span>
      </div>
    </div>
  )
}

/** Holds the hero logo's place until the 3D mark is ready. */
export function MarkLoader({ className }: { className?: string }) {
  return (
    <div className={cn('pointer-events-none absolute grid place-items-center', className)}>
      <ThinkingOrb state="working" size={64} aria-label="Loading the 3D mark" />
    </div>
  )
}
