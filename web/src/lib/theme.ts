// Light / dark theme on <html data-theme>. index.html sets it before first paint from the same key.
//
// The switch: an ink drop lands on the theme button, swells into a torn blot and floods the page,
// wisps running ahead of its edge, the last of the old theme breaking into streaks (~0.85 s).
// To keep it smooth, every frame of the ink mask is drawn ahead of time (idle time after load and
// after each switch) into small PNGs; the switch itself only steps a view-transition mask through
// them, which costs the browser almost nothing per frame.
export type Theme = 'light' | 'dark'

const KEY = 'sooth-theme'
const W = 480 // mask resolution; stretched to the viewport (ink edges are soft anyway)
const FRAMES = 30
const DURATION_MS = 950
const WARP_PX = 150 // how far the big swirl bends the blot into irregular lobes
const TEAR = 0.09 // fine raggedness of the edge
const VEIN = 0.14 // how far wisps reach ahead of the main front (share of the page diagonal)
const EDGE = 90 // edge sharpness: alpha ramps over 1/EDGE of the diagonal
const WISP_EDGE = 30 // wisp edges, a little softer than the body
const WISP_ALPHA = 0.75 // and a little translucent, like ink thinning in water

export const currentTheme = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Private mode or blocked storage: the theme still applies for this visit.
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t)
/** Measured off the reference video: a small drop (first ~12 %), the blot racing across the page,
 *  then a long tail while the last streaks of the old theme dissolve. Returns the front radius. */
function ease(t: number): number {
  if (t < 0.12) return 0.06 * (t / 0.12) ** 1.5
  if (t < 0.7) return 0.06 + 0.84 * smooth((t - 0.12) / 0.58)
  return 0.9 + 0.32 * (1 - (1 - (t - 0.7) / 0.3) ** 2)
}

/** RGB noise drawn by the browser's SVG turbulence into a canvas; alpha forced to 1. */
async function noise(w: number, h: number, type: 'fractalNoise' | 'turbulence', freq: string, octaves: number, seed: number): Promise<Uint8ClampedArray> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="${type}" baseFrequency="${freq}" numOctaves="${octaves}" seed="${seed}"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0 1"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`
  const img = new Image()
  img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`
  await img.decode()
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, w, h).data
}

type Wash = { urls: string[]; css: string; size: string }
let ready: Wash | null = null
let preparing = false

/** Draw every mask frame for an ink wash starting at (ox, oy) in viewport pixels. */
async function build(ox: number, oy: number): Promise<Wash> {
  const h = Math.round((W * innerHeight) / innerWidth)
  const s = W / innerWidth
  const [cx, cy] = [ox * s, oy * s]
  const seed = Math.floor(Math.random() * 1000)
  const swirl = await noise(W, h, 'fractalNoise', '0.007', 5, seed) // lobes at every scale
  const veins = await noise(W, h, 'turbulence', '0.02', 3, seed + 7) // ridges, read in polar space below
  const tear = await noise(W, h, 'fractalNoise', '0.05', 4, seed + 13) // ragged edge
  const reach = Math.hypot(Math.max(cx, W - cx), Math.max(cy, h - cy))

  // Two arrival maps (0 = at once, ~1 = last). body: distance from the drop through swirled
  // coordinates (the swirl grows with distance, so the drop starts round and tears as it spreads),
  // roughened at the edge. wisp: the same, pulled earlier along ridges read in polar space, so
  // faint fingers of ink run outwards ahead of the body.
  const body = new Float32Array(W * h)
  const wisp = new Float32Array(W * h)
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < W; x++, i++) {
      const p = i * 4
      const near = Math.min(1, Math.hypot(x - cx, y - cy) / (reach * 0.3))
      const wx = x + (swirl[p] / 255 - 0.5) * 2 * WARP_PX * near
      const wy = y + (swirl[p + 1] / 255 - 0.5) * 2 * WARP_PX * near
      const d = Math.hypot(wx - cx, wy - cy) / reach
      const across = Math.floor(((Math.atan2(wy - cy, wx - cx) / (2 * Math.PI) + 1) % 1) * W * 2) % W
      const along = Math.min(h - 1, Math.floor(d * h * 0.12))
      const ridge = (1 - veins[(along * W + across) * 4] / 255) ** 6 // turbulence dips to 0 along thin ridges
      body[i] = d + TEAR * (tear[p] / 255 - 0.5)
      wisp[i] = d - VEIN * ridge
    }
  }

  const canvas = new OffscreenCanvas(W, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  const frame = ctx.createImageData(W, h)
  const urls: string[] = []
  for (let k = 0; k < FRAMES; k++) {
    const front = ease(k / (FRAMES - 1))
    for (let i = 0; i < body.length; i++) {
      const solid = Math.max(0, Math.min(1, (front - body[i]) * EDGE))
      const faint = Math.max(0, Math.min(1, (front - wisp[i]) * WISP_EDGE)) * WISP_ALPHA
      frame.data[i * 4 + 3] = Math.max(solid, faint) * 255
    }
    ctx.putImageData(frame, 0, 0)
    const url = URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }))
    const decoded = new Image()
    decoded.src = url
    await decoded.decode() // decoded now, not mid-animation
    urls.push(url)
  }
  const steps = urls.map((u, k) => `${((k / FRAMES) * 100).toFixed(2)}% { mask-image: url("${u}"); -webkit-mask-image: url("${u}"); }`).join('\n')
  const css = `@keyframes ink-wash {\n${steps}\n100% { mask-image: none; -webkit-mask-image: none; }\n}
::view-transition-new(root) { mask-size: 100% 100%; -webkit-mask-size: 100% 100%; mask-repeat: no-repeat; -webkit-mask-repeat: no-repeat; animation: ink-wash ${DURATION_MS}ms linear both; }`
  return { urls, css, size: `${innerWidth}x${innerHeight}` }
}

/** Get the next wash ready in idle time, starting from the theme button. */
export function prepareInk(button: HTMLElement | null) {
  if (ready || preparing || !button || !document.startViewTransition || typeof OffscreenCanvas === 'undefined') return
  preparing = true
  const box = button.getBoundingClientRect()
  const run = () =>
    build(box.left + box.width / 2, box.top + box.height / 2)
      .then((wash) => (ready = wash))
      .catch(() => (ready = null)) // no wash: the switch is simply instant
      .finally(() => (preparing = false))
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2000 })
  else setTimeout(run, 200)
}

/** Switch theme; the prepared ink wash runs if it is ready, otherwise the switch is instant. */
export function switchTheme(next: Theme, button: HTMLElement | null) {
  const isStill = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const wash = ready
  if (isStill || !wash || !document.startViewTransition) {
    apply(next)
    return
  }
  ready = null
  if (wash.size !== `${innerWidth}x${innerHeight}`) {
    // The window changed shape since the frames were drawn: switch now, draw for the new size.
    for (const u of wash.urls) URL.revokeObjectURL(u)
    apply(next)
    prepareInk(button)
    return
  }
  const style = document.createElement('style')
  style.textContent = wash.css
  document.head.append(style)
  const transition = document.startViewTransition(() => apply(next))
  transition.finished.finally(() => {
    style.remove()
    for (const u of wash.urls) URL.revokeObjectURL(u)
    prepareInk(button) // fresh noise for the next switch
  })
}
