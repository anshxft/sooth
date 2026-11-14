// Scroll reveals for text, editorial style. Three kinds, all started by ScrollTrigger once:
//  - [data-reveal-lines]: a static heading split into masked lines that slide up one by one;
//  - [data-reveal-group]: its .rv-up children slide up out of their masks in turn (side lists);
//  - everything else that reads as text in <main> fades up a little, in small batches.
// Marked headings and lists always play (on load if already in view). Plain body text is touched
// only below the fold: what is on screen at load already has the page's rise animation. Splitting
// changes the DOM, so it is used only on static text, never on chain data.
import { useEffect } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'

gsap.registerPlugin(ScrollTrigger, SplitText)

const BODY = 'main p, main li, main dt, main dd, main h3, main tr, main pre'
const SETTLE_MS = 160 // wait for a burst of DOM changes (data arriving) before scanning again
const BELOW = 0.92 // share of the viewport height: lower than this counts as "below the fold"

export function useTextReveal(route: string) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const root = document.getElementById('root')
    if (!root) return
    const seen = new WeakSet<Element>()
    const triggers: ScrollTrigger[] = []
    const splits: SplitText[] = []
    const isBelow = (el: Element) => el.getBoundingClientRect().top > window.innerHeight * BELOW

    const scan = () => {
      const before = triggers.length
      const main = document.querySelector('main') // pages load lazily: look it up on every scan
      if (!main) return
      // Headings: masked lines.
      for (const el of document.querySelectorAll<HTMLElement>('main [data-reveal-lines]')) {
        if (seen.has(el) || el.closest('[data-no-reveal]')) continue
        seen.add(el)
        const split = SplitText.create(el, { type: 'lines', mask: 'lines' })
        splits.push(split)
        const tween = gsap.from(split.lines, {
          yPercent: 105, duration: 1, ease: 'power4.out', stagger: 0.09,
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        })
        if (tween.scrollTrigger) triggers.push(tween.scrollTrigger)
      }
      // Groups: each line already sits in its own mask.
      for (const el of document.querySelectorAll<HTMLElement>('main [data-reveal-group]')) {
        if (seen.has(el)) continue
        seen.add(el)
        const tween = gsap.from(el.querySelectorAll('.rv-up'), {
          yPercent: 110, duration: 1.05, ease: 'power4.out', stagger: 0.07,
          scrollTrigger: { trigger: el, start: 'top 85%', once: true },
        })
        if (tween.scrollTrigger) triggers.push(tween.scrollTrigger)
      }
      // Body text: fade up in batches, so a list or a table arrives row after row.
      const bodies = [...main.querySelectorAll<HTMLElement>(BODY)].filter((el) => {
        if (seen.has(el)) return false
        seen.add(el)
        // Not inside marked text, live regions, or closed panels (those fade in on their own).
        return !el.closest('[data-reveal-lines], [data-reveal-group], [aria-live], .expand, [inert], [data-no-reveal]') && isBelow(el)
      })
      if (bodies.length) {
        gsap.set(bodies, { opacity: 0, y: 14 })
        triggers.push(...ScrollTrigger.batch(bodies, {
          start: 'top 94%',
          once: true,
          onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.045, overwrite: true }),
        }))
      }
      if (triggers.length > before) ScrollTrigger.refresh() // costly: only when something new was set up
    }

    let timer = window.setTimeout(scan, SETTLE_MS)
    const watch = new MutationObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(scan, SETTLE_MS)
    })
    watch.observe(root, { childList: true, subtree: true })

    return () => {
      window.clearTimeout(timer)
      watch.disconnect()
      triggers.forEach((t) => t.kill())
      splits.forEach((s) => s.revert())
    }
  }, [route])
}
