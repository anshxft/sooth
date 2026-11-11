// Decorative motion shared by every page: text that decrypts, a trailing cursor ring and a live backdrop.
// All of it switches off on touch screens and for people who ask for reduced motion.
import { useEffect, useRef, useState } from 'react'

const GLYPHS = '▒░▓<>/\\_#01'
const SCRAMBLE_MS = 450
const RING_EASE = 0.18 // share of the remaining distance the ring covers each frame

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const hasFinePointer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches

/** Text that decodes from random glyphs, left to right, whenever it changes. Screen readers get the real text. */
export function Scramble({ text, className }: { text: string; className?: string }) {
  const [shown, setShown] = useState(text)
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(text)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / SCRAMBLE_MS)
      const settled = Math.floor(progress * text.length)
      setShown(
        [...text].map((c, i) => (i < settled || c === ' ' ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join(''),
      )
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [text])
  return (
    <span className={className} aria-label={text}>
      <span aria-hidden="true">{shown}</span>
    </span>
  )
}

/** A ring that trails the pointer and grows over anything clickable. Also feeds --mx / --my to the backdrop. */
export function Cursor() {
  const ring = useRef<HTMLDivElement>(null)
  const [isOn, setIsOn] = useState(false)
  useEffect(() => {
    if (!hasFinePointer() || prefersReducedMotion()) return
    setIsOn(true)
    const target = { x: -100, y: -100 }
    const at = { x: -100, y: -100 }
    let frame = 0
    const onMove = (e: PointerEvent) => {
      target.x = e.clientX
      target.y = e.clientY
      document.documentElement.style.setProperty('--mx', `${e.clientX}px`)
      document.documentElement.style.setProperty('--my', `${e.clientY}px`)
      const isClickable = e.target instanceof Element && e.target.closest('a, button, [role="button"]')
      ring.current?.classList.toggle('cursor-ring--hot', Boolean(isClickable))
    }
    const loop = () => {
      at.x += (target.x - at.x) * RING_EASE
      at.y += (target.y - at.y) * RING_EASE
      if (ring.current) ring.current.style.transform = `translate3d(${at.x}px, ${at.y}px, 0)`
      frame = requestAnimationFrame(loop)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    frame = requestAnimationFrame(loop)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(frame)
    }
  }, [])
  return isOn ? <div ref={ring} className="cursor-ring" aria-hidden="true"><span /></div> : null
}

/** Drifting dot grid behind the page, plus film grain and a cursor spotlight over it. Never takes clicks. */
export function Backdrop() {
  return (
    <>
      <div className="backdrop-grid" aria-hidden="true" />
      <div className="backdrop-spotlight" aria-hidden="true" />
      <div className="backdrop-grain" aria-hidden="true" />
    </>
  )
}
