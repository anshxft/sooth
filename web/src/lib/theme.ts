// Light / dark theme on <html data-theme>. index.html sets it before first paint from the same key.
// The switch washes the new theme across the page like ink in water, starting at the click point.
//
// How: on click we render one "ink field" (closeness to the click, torn and marbled by swirled
// noise) into a small canvas, once. The mask is that field run through a threshold whose intercept
// sweeps up (SMIL), so the ink front travels outwards. Rendering the noise once instead of every
// frame is what keeps it smooth. CSS lives in index.css under ::view-transition-new(root).
export type Theme = 'light' | 'dark'

const KEY = 'sooth-theme'
const WASH_SECS = 1.4 // keep in step with the ink-hold animation in index.css
const FIELD_W = 640 // ink field resolution; the mask stretches it to the viewport
const FIELD_H = 400
const SLOPE = 70 // edge sharpness: higher = crisper ink front

export const currentTheme = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Private mode or blocked storage: the theme still applies for this visit.
  }
}

const svgUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`

/** The ink field as a PNG: grey level = how early the ink reaches that pixel. (x, y) in percent. */
async function inkField(x: number, y: number): Promise<string> {
  const seed = Math.floor(Math.random() * 1000)
  // flow (ridged turbulence) swirls grain (domain warping) into marbled ink; the ink tears the
  // distance gradient (displacement) and is mixed into it. Kept inside 0..1 so nothing clamps flat.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${FIELD_W}" height="${FIELD_H}" viewBox="0 0 100 100" preserveAspectRatio="none">
<defs>
<radialGradient id="d" gradientUnits="userSpaceOnUse" cx="${x}" cy="${y}" r="145"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>
<filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="100" color-interpolation-filters="sRGB">
<feTurbulence type="turbulence" baseFrequency="0.015 0.035" numOctaves="3" seed="${seed}" result="flow"/>
<feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="4" seed="${seed + 1}" result="grain"/>
<feDisplacementMap in="grain" in2="flow" scale="55" xChannelSelector="R" yChannelSelector="G" result="ink"/>
<feDisplacementMap in="SourceGraphic" in2="ink" scale="32" xChannelSelector="R" yChannelSelector="B" result="torn"/>
<feComposite in="torn" in2="ink" operator="arithmetic" k2="0.62" k3="0.5" k4="-0.06" result="v"/>
<feColorMatrix in="v" type="matrix" values="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 1"/>
</filter>
</defs>
<rect width="100" height="100" fill="url(#d)" filter="url(#f)"/>
</svg>`
  const img = new Image()
  img.src = svgUrl(svg)
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = FIELD_W
  canvas.height = FIELD_H
  canvas.getContext('2d')?.drawImage(img, 0, 0, FIELD_W, FIELD_H)
  return canvas.toDataURL('image/png')
}

/** Mask: alpha = SLOPE * field + intercept, the intercept sweeping from none to all. */
function inkMask(field: string): string {
  const [from, to] = [-SLOPE - 1, 1]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">
<filter id="t" filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="100" color-interpolation-filters="sRGB">
<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0"/>
<feComponentTransfer><feFuncA type="linear" slope="${SLOPE}" intercept="${from}"><animate attributeName="intercept" from="${from}" to="${to}" dur="${WASH_SECS}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.35 0 0.25 1"/></feFuncA></feComponentTransfer>
</filter>
<image href="${field}" width="100" height="100" preserveAspectRatio="none" filter="url(#t)"/>
</svg>`
  return `url("${svgUrl(svg)}")`
}

/** Switch theme; with a click point the new theme washes out from it. */
export async function switchTheme(next: Theme, from?: { x: number; y: number }) {
  const isStill = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (isStill || !document.startViewTransition) {
    apply(next)
    return
  }
  const x = ((from?.x ?? innerWidth / 2) / innerWidth) * 100
  const y = ((from?.y ?? innerHeight / 2) / innerHeight) * 100
  try {
    document.documentElement.style.setProperty('--ink-mask', inkMask(await inkField(x, y)))
  } catch {
    apply(next) // the field could not be drawn (odd browser): switch without the wash
    return
  }
  document.startViewTransition(() => apply(next))
}
