// Live 3D bands. Each scene is its own chunk (three.js stays out of the first load), renders only
// while on screen, and draws one still frame when the visitor prefers reduced motion. The canvas
// is transparent, so the page colour shows through; scene colours follow the theme.
import { Suspense, lazy, useEffect, useRef, useState, type ComponentType } from 'react'
import { cn } from './utils'

/** isFramed: text sits on both sides, so the scene keeps to the middle. */
export type SceneProps = { isLive: boolean; isDark: boolean; isReduced: boolean; isFramed?: boolean }

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

/** An editorial list on one side of a scene: large light lines with small indices. */
export type Side = { title: string; kicker: string; prefix: string; items: string[] }

function SideList({ side, align }: { side: Side; align: 'left' | 'right' }) {
  const isRight = align === 'right'
  return (
    <div className={cn('pointer-events-auto flex flex-col', isRight && 'md:items-end')}>
      <div className={cn('flex w-full items-baseline justify-between gap-4', isRight && 'md:flex-row-reverse')}>
        <h3 className="text-lg font-normal tracking-[-0.01em]">{side.title}</h3>
        <span className="text-sm text-muted">{side.kicker}</span>
      </div>
      <ol className="mt-5 grid gap-1 md:mt-8">
        {side.items.map((item, i) => (
          <li key={item} className={cn('group flex items-baseline gap-4', isRight && 'md:flex-row-reverse')}>
            <span className="w-8 shrink-0 text-xs text-muted tabular-nums md:text-right">{side.prefix}.{i + 1}</span>
            <span className="text-[clamp(1.6rem,3.3vw,3.25rem)] font-light leading-[1.12] tracking-[-0.045em] text-muted transition-colors duration-300 group-hover:text-ink">
              {item}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function SceneBand({ name, label, className, sides }: { name: keyof typeof SCENES; label: string; className?: string; sides?: [Side, Side] }) {
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

  const scene = (
    <div ref={ref} role="img" aria-label={label} className={cn('relative h-[min(62vw,460px)] min-h-[260px] overflow-hidden', sides && 'md:h-[560px]', className)}>
      {hasEntered && (
        <Suspense fallback={null}>
          <Scene isLive={isLive && !isReduced} isDark={isDark} isReduced={isReduced} isFramed={Boolean(sides)} />
        </Suspense>
      )}
    </div>
  )
  if (!sides) return <div className="col-span-12">{scene}</div>
  // Wide screens: the lists sit over the scene's empty sides. Phones: they follow below it.
  return (
    <div className="relative col-span-12">
      {scene}
      <div className="pointer-events-none grid gap-10 px-6 pb-8 md:absolute md:inset-0 md:grid-cols-2 md:gap-16 md:px-8 md:py-8">
        <SideList side={sides[0]} align="left" />
        <SideList side={sides[1]} align="right" />
      </div>
    </div>
  )
}
