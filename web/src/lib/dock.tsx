// Bottom navigation dock: icons swell as the pointer nears them (springs), the current page wears a dot.
// Magnification after Cult UI's Dock (MIT, cult-ui.com/docs/components/dock); rebuilt as links for this app.
import { type MotionValue, motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import { type ReactNode, useRef, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { type Theme, currentTheme, switchTheme } from './theme'
import { cn } from './utils'

const SIZE = 44 // resting icon size, px
const PEAK = 68 // size right under the pointer
const REACH = 140 // px from an icon's centre where it stops growing
const SPRING = { mass: 0.1, stiffness: 170, damping: 13 }

const GITHUB = 'https://github.com/anshxft/sooth'
const EXPLORER = 'https://testnet.nearblocks.io/address/sooth.testnet'

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[45%]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
)
const ICONS = {
  arena: icon(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>),
  swarm: icon(<><path d="M12 3l4 2.3v4.6L12 12 8 9.9V5.3z" /><path d="M7 12l4 2.3v4.6L7 21l-4-2.1v-4.6z" /><path d="M17 12l4 2.3v4.6L17 21l-4-2.1v-4.6z" /></>),
  agents: icon(<><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 5.5a3 3 0 010 5M18 14.5c1.8.8 3 2.6 3 4.5" /></>),
  benchmark: icon(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>),
  github: icon(<path d="M9 19c-4 1.3-4-2-6-2.5m12 5v-3.2a2.8 2.8 0 00-.8-2.2c2.6-.3 5.3-1.3 5.3-5.8a4.5 4.5 0 00-1.2-3.1 4.2 4.2 0 00-.1-3.1s-1-.3-3.2 1.2a11 11 0 00-5.8 0C7 3.3 6 3.6 6 3.6a4.2 4.2 0 00-.1 3.1A4.5 4.5 0 004.7 9.8c0 4.5 2.7 5.5 5.3 5.8a2.8 2.8 0 00-.8 2.2V21" />),
  explorer: icon(<><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></>),
  sun: icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  moon: icon(<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />),
}

const PAGES = [
  ['/', 'Arena', ICONS.arena],
  ['/swarm', 'Swarm', ICONS.swarm],
  ['/agents', 'Agents', ICONS.agents],
  ['/benchmark', 'Benchmark', ICONS.benchmark],
] as const

export function Dock() {
  const mouseX = useMotionValue(Infinity)
  const [location] = useLocation()
  const [theme, setTheme] = useState<Theme>(currentTheme)
  const isActive = (href: string) => (href === '/' ? location === '/' || location.startsWith('/q/') : location.startsWith(href) || (href === '/swarm' && location.startsWith('/t/')))

  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-[max(12px,env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
      <motion.div
        onMouseMove={(e) => mouseX.set(e.clientX)}
        onMouseLeave={() => mouseX.set(Infinity)}
        className="flex h-[60px] items-end gap-1.5 rounded-2xl border border-line bg-canvas/85 px-2 pb-2 shadow-[0_8px_30px_rgb(0_0_0/0.12)] backdrop-blur-md"
      >
        {PAGES.map(([href, label, glyph]) => (
          <Item key={href} mouseX={mouseX} label={label} isActive={isActive(href)}>
            {(cls) => <Link href={href} aria-label={label} aria-current={isActive(href) ? 'page' : undefined} className={cls}>{glyph}</Link>}
          </Item>
        ))}
        <span aria-hidden="true" className="mx-1 mb-1 h-8 w-px self-end bg-line" />
        <Item mouseX={mouseX} label="Source on GitHub">
          {(cls) => <a href={GITHUB} target="_blank" rel="noopener noreferrer" aria-label="Source on GitHub" className={cls}>{ICONS.github}</a>}
        </Item>
        <Item mouseX={mouseX} label="Contract on explorer" className="hidden sm:flex">
          {(cls) => <a href={EXPLORER} target="_blank" rel="noopener noreferrer" aria-label="Contract on explorer" className={cls}>{ICONS.explorer}</a>}
        </Item>
        <Item mouseX={mouseX} label={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
          {(cls) => (
            <button
              type="button"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className={cls}
              onClick={(e) => {
                const next = theme === 'dark' ? 'light' : 'dark'
                // detail 0 = keyboard click: spread from the screen centre instead of the pointer.
                switchTheme(next, e.detail === 0 ? undefined : { x: e.clientX, y: e.clientY })
                setTheme(next)
              }}
            >
              {theme === 'dark' ? ICONS.sun : ICONS.moon}
            </button>
          )}
        </Item>
      </motion.div>
    </nav>
  )
}

type ItemProps = { mouseX: MotionValue<number>; label: string; isActive?: boolean; className?: string; children: (className: string) => ReactNode }

function Item({ mouseX, label, isActive = false, className, children }: ItemProps) {
  const ref = useRef<HTMLDivElement>(null)
  const distance = useTransform(mouseX, (x) => {
    const box = ref.current?.getBoundingClientRect()
    return box ? x - box.left - box.width / 2 : Infinity
  })
  const size = useSpring(useTransform(distance, [-REACH, 0, REACH], [SIZE, PEAK, SIZE]), SPRING)

  return (
    <motion.div ref={ref} style={{ width: size, height: size }} className={cn('group relative flex flex-col items-center', className)}>
      {children(
        cn(
          'flex size-full items-center justify-center rounded-xl border transition-colors duration-150',
          isActive ? 'border-ink bg-green text-ink' : 'border-line bg-canvas text-ink hover:border-ink',
        ),
      )}
      <span className="label pointer-events-none absolute -top-7 whitespace-nowrap rounded-md bg-ink px-1.5 py-0.5 text-canvas opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        {label}
      </span>
      {isActive && <span aria-hidden="true" className="absolute -bottom-1.5 size-1 rounded-full bg-ink" />}
    </motion.div>
  )
}
