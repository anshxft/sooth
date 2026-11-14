// Shared shell for the isometric figures (Fig 1 on Ask, Fig 2 on Swarm): theme, a time loop that runs
// only on screen, one still frame for reduced motion, click or Enter to switch scenario, and a readout.
import { useEffect, useRef, useState } from 'react'
import { ISO_CSS } from './iso-kit'
import { useIsDark } from './scene'

/** Finds a part by its data-part name. */
export type Query = (name: string) => SVGElement

type Props = {
  fig: string
  title: string
  label: string
  svg: string // our own generated geometry, never user input
  scenes: string[]
  cycle: number
  stillAt: number
  css?: string
  /** Poses every moving part at time t (seconds into the cycle) and returns the readout text. */
  draw: (q: Query, t: number, scene: number) => string
}

export function IsoFigure({ fig, title, label, svg, scenes, cycle, stillAt, css = '', draw }: Props) {
  const isDark = useIsDark()
  const stage = useRef<HTMLDivElement>(null)
  const [scene, setScene] = useState(0)
  const [readout, setReadout] = useState('')

  useEffect(() => {
    const root = stage.current
    if (!root) return
    const q: Query = (name) => root.querySelector(`[data-part="${name}"]`) as SVGElement
    const pose = (t: number) => {
      const text = draw(q, t, scene)
      setReadout((old) => (old === text ? old : text))
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { pose(stillAt); return }
    let frame = 0
    let start = 0
    let visible = false
    const tick = (now: number) => {
      if (!start) start = now
      pose(((now - start) / 1000) % cycle)
      frame = visible ? requestAnimationFrame(tick) : 0
    }
    pose(0)
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible && !frame) frame = requestAnimationFrame(tick)
    })
    io.observe(root)
    return () => { io.disconnect(); cancelAnimationFrame(frame) }
  }, [scene, draw, cycle, stillAt])

  const next = () => setScene((s) => (s + 1) % scenes.length)
  return (
    <figure className="iso iso-fig" data-theme={isDark ? 'dark' : 'light'}>
      <style>{ISO_CSS + BASE_CSS + css}</style>
      <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2">
        <span className="label text-muted">{fig} · {title}</span>
        <span className="label text-muted">Click to switch · {scenes[scene]}</span>
      </div>
      <div
        ref={stage}
        role="button"
        tabIndex={0}
        aria-label={`${label} Showing ${scenes[scene]}. Press to switch.`}
        onClick={next}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next() } }}
        className="cursor-pointer"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <figcaption className="label pt-2" aria-live="polite">{readout}</figcaption>
    </figure>
  )
}

const BASE_CSS = '.iso-fig{--anatomy-paper:var(--color-canvas);--anatomy-red:#ff4f2b}'
