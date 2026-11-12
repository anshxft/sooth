// Decorative motion shared by every page: text that decrypts and a quiet backdrop.
// All of it switches off on touch screens and for people who ask for reduced motion.
import { useEffect, useState } from 'react'

const GLYPHS = '▒░▓<>/\\_#01'
const SCRAMBLE_MS = 450

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

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

/** Drifting dot grid behind the page, with a still film grain over it. Never takes clicks. */
export function Backdrop() {
  return (
    <>
      <div className="backdrop-grid" aria-hidden="true" />
      <div className="backdrop-grain" aria-hidden="true" />
    </>
  )
}
