// A time pill: clock + tabular digits. Look and variants after Cult UI's Timer (MIT,
// cult-ui.com/docs/components/timer), rebuilt without cva / lucide for the Swiss palette here.
import { cn } from './utils'
import { countdown, nsToMs } from './near'

const URGENT_SECS = 15 // the last seconds of a phase turn red

type Tone = 'settled' | 'live' | 'urgent'

const TONE: Record<Tone, string> = {
  settled: 'border-ink/30 text-ink',
  live: 'border-ink bg-green text-ink',
  urgent: 'border-red bg-red/10 text-red',
}

export function Timer({ time, tone = 'settled', label, caption, className }: { time: string; tone?: Tone; label: string; caption?: string; className?: string }) {
  return (
    <span role="timer" aria-label={`${label}: ${time}`} className={cn('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 font-mono text-sm tabular-nums', TONE[tone], className)}>
      <svg viewBox="0 0 16 16" aria-hidden="true" className={cn('size-3.5', tone !== 'settled' && 'timer-hand')}>
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {caption && <span className="label opacity-70">{caption}</span>}
      {time}
    </span>
  )
}

/** Time left in a phase; turns red near the end. Renders nothing without a deadline. */
export function Countdown({ endsAt, now, className }: { endsAt: string | null | undefined; now: number; className?: string }) {
  const left = countdown(endsAt, now)
  if (!left || !endsAt) return null
  const isUrgent = nsToMs(endsAt) - now < URGENT_SECS * 1000
  return <Timer time={left} tone={isUrgent ? 'urgent' : 'live'} label="Time left in this phase" className={className} />
}

/** "mm:ss" (or "h:mm:ss") between two block timestamps in nanoseconds. */
export function elapsed(fromNs: string, toNs: string): string {
  const s = Math.max(0, Math.round((nsToMs(toNs) - nsToMs(fromNs)) / 1000))
  const [h, m, sec] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
  const mmss = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return h > 0 ? `${h}:${mmss}` : mmss
}
