// Falling NEAR notes drawn in ASCII over the page: escrow paying out. Each note is a flat
// pattern (border, frame, portrait, seals, corner marks) that tumbles in 3D and bends in an S that
// rolls along it as it falls; the sampled surface is projected onto a character grid with a depth
// buffer, and characters are picked by pattern part and lighting. Written for this app after an
// ASCII "falling bills" clip; no code from it.
import { useEffect, useRef } from 'react'

const CHAR_H = 12 // px per character row; the cell width is measured from the font
const FPS = 30
const SAMPLES_U = 46 // surface samples along the note
const SAMPLES_V = 20 // and across it
const ASPECT = 0.43 // note height / length
const LIGHT = normalize([-0.35, -0.6, 0.72])

type Part = 'paper' | 'border' | 'frame' | 'portrait' | 'face' | 'seal' | 'corner'
type Vec = [number, number, number]
type Note = { x: number; speed: number; delay: number; sway: number; phase: number; spin: Vec; tilt: Vec; size: number }

function normalize([x, y, z]: Vec): Vec {
  const l = Math.hypot(x, y, z)
  return [x / l, y / l, z / l]
}

/** Which part of the note a surface point (u in -1..1, v in -1..1) belongs to. */
function part(u: number, v: number): Part {
  const [au, av] = [Math.abs(u), Math.abs(v)]
  if (au > 0.94 || av > 0.88) return 'border'
  if (au > 0.74 && av > 0.52) return 'corner'
  if ((au > 0.84 && au < 0.89) || (av > 0.72 && av < 0.78)) return 'frame'
  if ((u / 0.2) ** 2 + ((v + 0.05) / 0.42) ** 2 < 1) return 'face'
  if ((u / 0.32) ** 2 + (v / 0.68) ** 2 < 1) return 'portrait'
  if (Math.hypot((au - 0.55) / 0.16, v / 0.36) < 1) return 'seal'
  return 'paper'
}

const GLYPH: Record<Exclude<Part, 'paper'>, string> = { border: '#', frame: '=', corner: 'N', seal: 'o', portrait: ':', face: '@' }
const PAPER = ' .,-~=+' // by light

/** Deterministic random in 0..1 for (note, generation). */
const rand = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}

function makeNote(i: number, gen: number): Note {
  const r = (k: number) => rand(i * 7 + k, gen)
  return {
    x: r(1) * 1.1 - 0.05,
    speed: 0.09 + r(2) * 0.07, // panel heights per second
    delay: r(3) * 6,
    sway: 0.03 + r(4) * 0.05,
    phase: r(5) * Math.PI * 2,
    spin: [(r(6) - 0.5) * 1.6, (r(7) - 0.5) * 2.2, (r(8) - 0.5) * 1.2],
    tilt: [r(9) * 6, r(10) * 6, r(11) * 6],
    size: 0.17 + r(12) * 0.07, // half-length as a share of panel width
  }
}

/** Rotate about x, then y, then z. */
function rotate([x, y, z]: Vec, [a, b, c]: Vec): Vec {
  const [y1, z1] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)]
  const [x2, z2] = [x * Math.cos(b) + z1 * Math.sin(b), -x * Math.sin(b) + z1 * Math.cos(b)]
  return [x2 * Math.cos(c) - y1 * Math.sin(c), x2 * Math.sin(c) + y1 * Math.cos(c), z2]
}

/** Falling notes over whatever is behind the canvas (transparent). `scale` sizes the notes. */
export function Bills({ count = 12, scale = 1, className }: { count?: number; scale?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const isStill = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let [cols, rows, w, h, charW] = [0, 0, 0, 0, 7]
    let depth = new Float32Array(0)
    let light = new Float32Array(0)
    let cell: string[] = []

    const resize = () => {
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * devicePixelRatio
      canvas.height = h * devicePixelRatio
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
      ctx.font = `${CHAR_H - 1}px "JetBrains Mono", ui-monospace, monospace`
      ctx.textBaseline = 'top'
      charW = ctx.measureText('M').width // rows are drawn as whole strings, so cells must match the font
      cols = Math.ceil(w / charW)
      rows = Math.ceil(h / CHAR_H)
      depth = new Float32Array(cols * rows)
      light = new Float32Array(cols * rows)
      cell = Array.from({ length: cols * rows }, () => '')
    }

    const draw = (t: number) => {
      depth.fill(-Infinity)
      cell.fill('')
      for (let i = 0; i < count; i++) {
        // Each note falls from above the panel to below it, then comes back as a new note.
        const first = makeNote(i, 0)
        const span = 1.8 / first.speed
        const local = t + first.delay
        const n = makeNote(i, Math.floor(local / span) + 1)
        const p = (local % span) / span // 0..1 through its fall
        const L = n.size * Math.min(w, h * 1.5) * scale
        const cx = (n.x + n.sway * Math.sin(local * 1.1 + n.phase)) * w
        const cy = (p * 1.8 - 0.4) * h
        const ang: Vec = [n.tilt[0] + n.spin[0] * local, n.tilt[1] + n.spin[1] * local, n.tilt[2] + n.spin[2] * local]
        const normal = rotate([0, 0, 1], ang)
        const facing = normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]
        for (let a = 0; a < SAMPLES_U; a++) {
          const u = (a / (SAMPLES_U - 1)) * 2 - 1
          // An S-shaped bend that rolls along the note as it falls.
          const bend = 0.16 * Math.sin(u * 2.2 + n.phase + local * 2.4) * L
          for (let b = 0; b < SAMPLES_V; b++) {
            const v = (b / (SAMPLES_V - 1)) * 2 - 1
            const [x, y, z] = rotate([u * L, v * L * ASPECT, bend], ang)
            const col = Math.floor((cx + x) / charW)
            const row = Math.floor((cy + y) / CHAR_H)
            if (col < 0 || row < 0 || col >= cols || row >= rows) continue
            const k = row * cols + col
            if (z <= depth[k]) continue
            depth[k] = z
            const shade = Math.min(1, 0.25 + 0.75 * Math.abs(facing) + (bend / L) * 0.6)
            const kind = part(u, v)
            cell[k] = kind === 'paper' ? PAPER[Math.max(1, Math.round(shade * (PAPER.length - 1)))] : GLYPH[kind]
            light[k] = facing < 0 ? shade * 0.55 : shade // the back of a note is dimmer
          }
        }
      }
      ctx.clearRect(0, 0, w, h)
      // Green on the dark theme, ink on the light one; read each frame so a theme switch follows.
      const root = getComputedStyle(document.documentElement)
      const isDark = document.documentElement.dataset.theme === 'dark'
      const color = (isDark ? root.getPropertyValue('--color-green') : root.getPropertyValue('--color-ink')).trim() || '#7ffab7'
      const strength = isDark ? 0.75 : 0.35 // faint enough to read the page through
      // One string per row per brightness bucket: a few hundred fillText calls instead of thousands.
      for (let bucket = 1; bucket <= 4; bucket++) {
        ctx.fillStyle = color
        ctx.globalAlpha = (0.15 + bucket * 0.2) * strength
        for (let r = 0; r < rows; r++) {
          let line = ''
          let any = false
          for (let c = 0; c < cols; c++) {
            const k = r * cols + c
            const isHere = cell[k] !== '' && Math.min(4, Math.max(1, Math.ceil(light[k] * 4))) === bucket
            line += isHere ? cell[k] : ' '
            any ||= isHere
          }
          if (any) ctx.fillText(line, 0, r * CHAR_H)
        }
      }
      ctx.globalAlpha = 1
    }

    resize()
    let frame = 0
    let last = 0
    let isOnScreen = false
    const start = performance.now()
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop)
      if (!isOnScreen || now - last < 1000 / FPS) return
      last = now
      draw((now - start) / 1000)
    }
    const visibility = new IntersectionObserver(([entry]) => {
      isOnScreen = entry.isIntersecting
    })
    if (isStill) draw(4)
    else {
      visibility.observe(canvas)
      frame = requestAnimationFrame(loop)
    }
    const onResize = () => {
      resize()
      if (isStill) draw(4)
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      visibility.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [count, scale])

  return <canvas ref={ref} className={className} aria-hidden="true" />
}
