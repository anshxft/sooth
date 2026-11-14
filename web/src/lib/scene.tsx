// Live 3D bands. Each scene is its own chunk (three.js stays out of the first load), renders only
// while on screen, and draws one still frame when the visitor prefers reduced motion. The canvas
// is transparent, so the page colour shows through; scene colours follow the theme.
import { Suspense, lazy, useEffect, useRef, useState, type ComponentType } from 'react'
import { cn } from './utils'

export type SceneProps = { isLive: boolean; isDark: boolean; isReduced: boolean }

const SCENES: Record<string, ComponentType<SceneProps>> = {
  consensus: lazy(() => import('./scenes/Consensus')),
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

export function SceneBand({ name, label, className }: { name: keyof typeof SCENES; label: string; className?: string }) {
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
    <div ref={ref} role="img" aria-label={label} className={cn('relative col-span-12 h-[min(62vw,460px)] min-h-[260px] overflow-hidden', className)}>
      {hasEntered && (
        <Suspense fallback={null}>
          <Scene isLive={isLive && !isReduced} isDark={isDark} isReduced={isReduced} />
        </Suspense>
      )}
    </div>
  )
}
