// Friendly agent faces: a soft shape in a pastel, two eyes that blink now and then, a slow float.
// Each named agent keeps the same face everywhere; unknown names get one picked from their name.
import type { CSSProperties, ReactElement } from 'react'
import { cn } from './utils'

type Shape = 'square' | 'circle' | 'pill' | 'triangle' | 'blob'
type Eyes = 'dots' | 'happy' | 'wide' | 'side'
type Face = { color: string; shape: Shape; eyes: Eyes }

const FACES: Record<string, Face> = {
  atlas: { color: '#f2b27a', shape: 'square', eyes: 'dots' },
  nova: { color: '#a6e28e', shape: 'square', eyes: 'dots' },
  sage: { color: '#a8c8f8', shape: 'circle', eyes: 'happy' },
  echo: { color: '#6ee6cc', shape: 'pill', eyes: 'happy' },
  mallory: { color: '#f5a3b5', shape: 'triangle', eyes: 'side' }, // the bribed one looks away
  quill: { color: '#c9a8f5', shape: 'blob', eyes: 'wide' },
  ledger: { color: '#f2d27a', shape: 'circle', eyes: 'dots' },
  shade: { color: '#9aa0a6', shape: 'triangle', eyes: 'side' }, // the cheater
  contractor: { color: '#f2b27a', shape: 'pill', eyes: 'wide' },
}
const POOL: Face[] = Object.values(FACES)

function faceFor(name: string): Face {
  const known = FACES[name.toLowerCase()]
  if (known) return known
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return POOL[h % POOL.length]
}

const BODY: Record<Shape, ReactElement> = {
  square: <rect x="10" y="10" width="80" height="80" rx="18" />,
  circle: <circle cx="50" cy="50" r="42" />,
  pill: <rect x="6" y="24" width="88" height="52" rx="26" />,
  triangle: <path d="M50 10 C55 10 58 13 61 18 L92 76 C96 84 91 90 83 90 L17 90 C9 90 4 84 8 76 L39 18 C42 13 45 10 50 10 Z" />,
  blob: <path d="M52 8 C76 8 92 24 92 48 C92 74 74 92 48 92 C24 92 8 76 8 52 C8 30 26 8 52 8 Z" />,
}

function EyesOf({ eyes, shape }: { eyes: Eyes; shape: Shape }) {
  const y = shape === 'triangle' ? 62 : 50
  const ink = '#1a1a19'
  if (eyes === 'happy') {
    return (
      <g className="face-eyes" stroke={ink} strokeWidth="5" strokeLinecap="round" fill="none">
        <path d={`M30 ${y + 2} Q37 ${y - 6} 44 ${y + 2}`} />
        <path d={`M56 ${y + 2} Q63 ${y - 6} 70 ${y + 2}`} />
      </g>
    )
  }
  const r = eyes === 'wide' ? 6.5 : 5.5
  const dx = eyes === 'side' ? 5 : 0
  return (
    <g className="face-eyes" fill={ink}>
      {eyes === 'wide' && <><circle cx="37" cy={y} r="9" fill="#fff" /><circle cx="63" cy={y} r="9" fill="#fff" /></>}
      <circle cx={37 + dx} cy={y} r={r} />
      <circle cx={63 + dx} cy={y} r={r} />
    </g>
  )
}

/** `delay` staggers blinking so a row of faces does not blink in unison. */
export function AgentFace({ name, size = 48, className }: { name: string; size?: number; className?: string }) {
  const face = faceFor(name)
  let seed = 0
  for (const ch of name) seed += ch.charCodeAt(0)
  const style = { '--blink-delay': `${(seed % 37) / 10}s`, '--float-delay': `${(seed % 23) / 10}s` } as CSSProperties
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" className={cn('face shrink-0', className)} style={style}>
      <g className="face-body" fill={face.color}>{BODY[face.shape]}</g>
      <EyesOf eyes={face.eyes} shape={face.shape} />
    </svg>
  )
}
