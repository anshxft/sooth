// First-visit intro (once per browser session, about 2.4 s): the six aperture blades fly in and close
// into the SOOTH mark, the name rises letter by letter, a hairline fills, then the curtain lifts.
// Pure CSS keyframes (smooth even while the page is still loading). Click or any key skips it;
// reduced motion skips it entirely. The scroll animations underneath are untouched.
import { useEffect, useState, type CSSProperties } from 'react'
import { BLADES } from './hero/Mark'

const KEY = 'sooth-intro'
const NAME = 'sooth'

function shouldPlay(): boolean {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  try {
    if (sessionStorage.getItem(KEY)) return false
    sessionStorage.setItem(KEY, '1')
  } catch {
    // storage blocked: still play once for this page load
  }
  return true
}

export function Intro() {
  const [isOn, setIsOn] = useState(shouldPlay)
  const [isLeaving, setIsLeaving] = useState(false)

  useEffect(() => {
    if (!isOn) return
    const skip = () => setIsLeaving(true)
    window.addEventListener('keydown', skip, { once: true })
    return () => window.removeEventListener('keydown', skip)
  }, [isOn])

  if (!isOn) return null
  return (
    <div
      className="intro"
      data-leaving={isLeaving ? '' : undefined}
      aria-hidden="true"
      onClick={() => setIsLeaving(true)}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) setIsOn(false) }}
    >
      <div className="intro-stage">
        <svg viewBox="-75 -75 150 150" className="intro-mark">
          {BLADES.map((d, i) => {
            const a = ((i * 60 + 30) * Math.PI) / 180
            const style = { '--dx': `${Math.cos(a) * 90}px`, '--dy': `${Math.sin(a) * 90}px`, animationDelay: `${i * 70}ms` } as CSSProperties
            return <path key={d} d={d} className="intro-blade" style={style} />
          })}
        </svg>
        <div className="intro-name font-display">
          {[...NAME].map((c, i) => (
            <span key={i} className="intro-letter" style={{ animationDelay: `${700 + i * 60}ms` }}>{c}</span>
          ))}
        </div>
        <p className="label intro-tag">Many agents. One truth.</p>
        <div className="intro-line" />
      </div>
    </div>
  )
}
