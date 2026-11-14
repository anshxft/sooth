// Live 3D bands. Each scene is its own chunk (three.js stays out of the first load), renders only
// while on screen, and draws one still frame when the visitor prefers reduced motion. The canvas
// is transparent, so the page colour shows through; scene colours follow the theme.
import { Suspense, lazy, useEffect, useRef, useState, type ComponentType } from 'react'
import { cn } from './utils'

/** isFramed: the scene sits in a narrow box, so it keeps to the middle. */
export type SceneProps = { isLive: boolean; isDark: boolean; isReduced: boolean; isFramed?: boolean }

const SCENES: Record<string, ComponentType<SceneProps>> = {
  flock: lazy(() => import('./scenes/Flock')),
}

function useIsDark(): boolean {
  const read = () => document.documentElement.dataset.theme === 'dark'
  const [isDark, setIsDark] = useState(read)
  useEffect(() => {
    const watch = new MutationObserver(() => setIsDark(read()))
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => watch.disconnect()
  }, [])
  return isDark
}

/** A live 3D scene in its own box; the page decides where the box sits. */
export function SceneBand({ name, label, className, isFramed = false }: { name: keyof typeof SCENES; label: string; className?: string; isFramed?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [isLive, setIsLive] = useState(false)
  const [hasEntered, setHasEntered] = useState(false)
  const [isReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const isDark = useIsDark()
  const Scene = SCENES[name]

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => {
      setIsLive(entry.isIntersecting)
      if (entry.isIntersecting) setHasEntered(true)
    }, { rootMargin: '200px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} role="img" aria-label={label} className={cn('relative min-h-[260px] overflow-hidden', className)}>
      {hasEntered && (
        <Suspense fallback={null}>
          <Scene isLive={isLive && !isReduced} isDark={isDark} isReduced={isReduced} isFramed={isFramed} />
        </Suspense>
      )}
    </div>
  )
}
