// Light / dark theme on <html data-theme>. index.html sets it before first paint from the same key.
// The switch spreads like ink from the click point (CSS in index.css, ::view-transition-new).
export type Theme = 'light' | 'dark'

const KEY = 'sooth-theme'

export const currentTheme = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Private mode or blocked storage: the theme still applies for this visit.
  }
}

/** Switch theme; with a click point the new theme bleeds out from it. */
export function switchTheme(next: Theme, from?: { x: number; y: number }) {
  const isStill = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (isStill || !document.startViewTransition) {
    apply(next)
    return
  }
  const root = document.documentElement.style
  root.setProperty('--ink-x', `${from?.x ?? innerWidth / 2}px`)
  root.setProperty('--ink-y', `${from?.y ?? innerHeight / 2}px`)
  document.startViewTransition(() => apply(next))
}
