// Big type answers the cursor: letters near the pointer lift a little, the one under it takes the
// accent, and all ease back when the pointer leaves. A heading is split into letter spans the first
// time the pointer enters it (static text only; headings showing live chain data opt out with
// data-no-hover). Mouse and trackpad only; off for touch and for reduced motion.
import { useEffect } from 'react'
import { gsap } from 'gsap'

const TARGETS = 'main h1, main h2, .rv-up, [data-chapter] .ch-line'
const RADIUS = 140 // px around the pointer that letters feel
const LIFT = 0.22 // of the font size, at the pointer
const ACCENT = 'var(--color-green)'

type Letter = { el: HTMLElement; y: gsap.QuickToFunc; hot: boolean }
const split = new WeakMap<Element, Letter[]>()

/** Wraps each visible character of the element's text in a span (spaces stay plain text). */
function letters(target: Element): Letter[] {
  const known = split.get(target)
  if (known) return known
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  const out: Letter[] = []
  for (const node of nodes) {
    if (!node.textContent?.trim()) continue
    const frag = document.createDocumentFragment()
    // Letters sit inside a no-wrap word, so a heading still breaks between words, never inside one.
    for (const part of node.textContent.split(/(\s+)/)) {
      if (!part) continue
      if (/^\s+$/.test(part)) { frag.append(part); continue }
      const word = document.createElement('span')
      word.className = 'hw'
      for (const ch of part) {
        const span = document.createElement('span')
        span.className = 'hl'
        span.textContent = ch
        word.append(span)
        out.push({ el: span, y: gsap.quickTo(span, 'y', { duration: 0.45, ease: 'power3.out' }), hot: false })
      }
      frag.append(word)
    }
    node.replaceWith(frag)
  }
  split.set(target, out)
  return out
}

export function useHoverText(route: string) {
  useEffect(() => {
    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!canHover || isReduced) return
    let active: Element | null = null
    let size = 16

    const settle = (target: Element) => {
      for (const l of split.get(target) ?? []) {
        l.y(0)
        if (l.hot) { l.hot = false; l.el.style.color = '' }
      }
    }
    const onMove = (e: PointerEvent) => {
      const hit = (e.target as Element | null)?.closest?.(TARGETS)
      const target = hit && !hit.closest('[data-no-hover]') ? hit : null
      if (target !== active) {
        if (active) settle(active)
        active = target
        if (target) size = parseFloat(getComputedStyle(target).fontSize) || 16
      }
      if (!target) return
      for (const l of letters(target)) {
        const r = l.el.getBoundingClientRect()
        const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2))
        const k = Math.max(0, 1 - d / RADIUS)
        l.y(-k * k * LIFT * size)
        const hot = k > 0.86
        if (hot !== l.hot) { l.hot = hot; l.el.style.color = hot ? ACCENT : '' }
      }
    }
    const onLeave = () => { if (active) settle(active); active = null }
    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
    }
  }, [route])
}
