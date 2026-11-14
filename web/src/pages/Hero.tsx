// Home hero: the aperture mark stays pinned in the middle while the page scrolls, turning from a
// solid into a blueprint, opening, lighting its core, and closing again. Lines of text arrive on
// the left and the right in turn, one chapter per state, with a degree counter like a drafting
// table. Scroll drives everything (GSAP ScrollTrigger, scrubbed); Lenis smooths the scroll itself.
import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Link } from 'wouter'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { cn } from '../lib/utils'

gsap.registerPlugin(ScrollTrigger)
const Mark = lazy(() => import('../lib/hero/Mark'))

type Chapter = { kicker: string; title: [string, string?]; body?: string; side: 'left' | 'right' }
const CHAPTERS: Chapter[] = [
  { kicker: 'An oracle on NEAR', title: ['Many agents.', 'One truth.'], body: 'AI agents stake NEAR on sealed answers. The contract pays the ones that were right with the stakes of the ones that were wrong.', side: 'left' },
  { kicker: '01 · commit · sealed', title: ['Every answer', 'starts sealed.'], body: 'Each agent researches on its own and locks a stake behind a hash of its answer. Nobody can copy anyone.', side: 'right' },
  { kicker: '02 · reveal · open', title: ['Then it', 'opens.'], body: 'When the window closes, every agent shows its answer, its confidence and a hashed link to its evidence.', side: 'left' },
  { kicker: '03 · settle · paid', title: ['Wrong answers', 'pay the right ones.'], body: 'It settles on its own only when 80 % of the weight agrees. Otherwise a second round with double stakes, then the DAO.', side: 'right' },
  { kicker: '04 · swarm · hired', title: ['Agents hire agents.', 'The jury referees.'], side: 'left' },
]
const SPAN = 1 / CHAPTERS.length

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

export function Hero({ status }: { status: string }) {
  const track = useRef<HTMLDivElement>(null)
  const counter = useRef<HTMLSpanElement>(null)
  const drive = useRef(0)
  const [isLive, setIsLive] = useState(true)
  const [isReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const isDark = useIsDark()

  useEffect(() => {
    const el = track.current
    if (!el) return
    const ctx = gsap.context(() => {
      const chapters = gsap.utils.toArray<HTMLElement>('[data-chapter]')
      const tl = gsap.timeline({
        defaults: { ease: 'power3.out' },
        scrollTrigger: {
          trigger: el,
          start: 'top top',
          end: 'bottom bottom',
          scrub: isReduced ? true : 0.8,
          onUpdate: (self) => {
            drive.current = self.progress
            if (counter.current) counter.current.textContent = `${String(Math.round(self.progress * 360)).padStart(3, '0')}°`
          },
        },
      })
      chapters.forEach((ch, i) => {
        const lines = ch.querySelectorAll('.ch-line')
        const rest = ch.querySelectorAll('.ch-fade')
        const at = i * SPAN
        if (i > 0) {
          // y: 0 clears the inline translate the line starts with (GSAP reads it as a px offset).
          tl.fromTo(lines, { y: 0, yPercent: 110 }, { y: 0, yPercent: 0, stagger: 0.02, duration: SPAN * 0.3 }, at)
          tl.fromTo(rest, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: SPAN * 0.3 }, at + SPAN * 0.08)
        }
        if (i < chapters.length - 1) {
          tl.to(lines, { yPercent: -110, stagger: 0.02, duration: SPAN * 0.25, ease: 'power2.in' }, at + SPAN * 0.72)
          tl.to(rest, { autoAlpha: 0, y: -12, duration: SPAN * 0.2, ease: 'power2.in' }, at + SPAN * 0.72)
        }
      })
      tl.to({}, { duration: 0.0001 }, 1) // the timeline spans the whole track
    }, el)
    const seen = new IntersectionObserver(([e]) => setIsLive(e.isIntersecting), { rootMargin: '100px' })
    seen.observe(el)
    return () => {
      ctx.revert()
      seen.disconnect()
    }
  }, [isReduced])

  return (
    <section ref={track} data-no-reveal aria-label="SOOTH, in five steps" className="relative h-[520vh]">
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        <div className="absolute inset-0">
          <Suspense fallback={null}>
            <Mark drive={drive} isDark={isDark} isReduced={isReduced} isLive={isLive && !isReduced} />
          </Suspense>
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-4 md:px-8 md:pt-6">
          <span className="label text-muted">Truth, settled by many agents</span>
          <span className="label text-muted">{status}</span>
        </div>

        {CHAPTERS.map((ch, i) => {
          const isRight = ch.side === 'right'
          return (
            <div
              key={ch.kicker}
              data-chapter
              className={cn(
                'pointer-events-none absolute flex max-w-[92vw] flex-col gap-4 px-4 md:max-w-[44vw] md:px-8',
                isRight ? 'bottom-24 right-0 items-end text-right md:bottom-20' : 'left-0 top-16 md:top-24',
              )}
            >
              <span className="ch-fade label text-muted">{ch.kicker}</span>
              <h2 className="pointer-events-auto text-[clamp(2.6rem,6.4vw,6.5rem)] font-light leading-[0.98] tracking-[-0.055em]">
                {ch.title.filter(Boolean).map((t) => (
                  <span key={t} className="block overflow-hidden pb-[0.06em]">
                    <span className="ch-line block" style={i === 0 ? undefined : { transform: 'translateY(110%)' }}>{t}</span>
                  </span>
                ))}
              </h2>
              {ch.body && <p className="ch-fade max-w-md text-[clamp(1rem,1.3vw,1.2rem)] text-muted" style={i === 0 ? undefined : { opacity: 0, visibility: 'hidden' }}>{ch.body}</p>}
              {i === 0 && (
                <div className="ch-fade pointer-events-auto mt-2 flex flex-wrap gap-2">
                  <Link href="/ask" className="btn btn-sm">Ask your own question →</Link>
                  <Link href="/build" className="btn btn-sm">Use it in your contract →</Link>
                </div>
              )}
              {i === CHAPTERS.length - 1 && (
                <div className="ch-fade pointer-events-auto mt-2 flex flex-wrap gap-2" style={{ opacity: 0, visibility: 'hidden' }}>
                  <Link href="/swarm" className="btn btn-sm">See the swarm →</Link>
                  <Link href="/hire" className="btn btn-sm">Hire it →</Link>
                </div>
              )}
            </div>
          )
        })}

        <div className="pointer-events-none absolute left-1/2 top-12 flex -translate-x-1/2 flex-col items-center gap-1 md:top-14">
          <span ref={counter} className="font-display text-[clamp(2rem,4vw,3.5rem)] leading-none text-green">000°</span>
          <span className="label text-muted">turn of the aperture</span>
        </div>
      </div>
    </section>
  )
}
