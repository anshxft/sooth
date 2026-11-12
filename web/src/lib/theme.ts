// Light / dark theme on <html data-theme>. index.html sets it before first paint from the same key.
//
// The switch: an ink drop lands on the theme button, swells into a torn blot and floods the page,
// its edge marbled into curling streaks like ink spreading in liquid, wisps running ahead (~1 s).
// To keep it smooth, every frame of the ink mask is drawn ahead of time (idle time after load and
// after each switch) into one sprite; the switch only steps the view-transition mask through it,
// which costs the browser almost nothing per frame.
export type Theme = 'light' | 'dark'

const KEY = 'sooth-theme'
const W = 480 // mask resolution; stretched to the viewport (ink edges are soft anyway)
const FRAMES = 45 // ~45 fps over the wash
const COLS = 9 // frames sit in a 9 x 5 grid: a tall single strip would pass the GPU's texture limit on phones
const ROWS = Math.ceil(FRAMES / COLS)
const DURATION_MS = 1000
const WARP_PX = 150 // how far the big swirl bends the blot into irregular lobes
const TEAR = 0.09 // fine raggedness of the edge
const VEIN = 0.14 // how far wisps reach ahead of the main front (share of the page diagonal)
const EDGE = 90 // edge sharpness: alpha ramps over 1/EDGE of the diagonal
const WISP_EDGE = 30 // wisp edges, a little softer than the body
const WISP_ALPHA = 0.75 // and a little translucent, like ink thinning in water
const MARBLE = 0.32 // width of the marbled band where ink and page streak into each other
const MARBLE_WARP_PX = 70 // how hard the flow drags those streaks (domain warping)

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
  return 0.9 + 0.45 * (1 - (1 - (t - 0.7) / 0.3) ** 2)
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

type Wash = { url: string; css: string; size: string }
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
  const flow = await noise(W, h, 'fractalNoise', '0.009', 3, seed + 21) // where the liquid pushes
  const streak = await noise(W, h, 'turbulence', '0.022 0.012', 4, seed + 29) // thin ridges it drags
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
      // Marbling: read the ridges at a point pushed along the flow, so they stretch into the long
      // curling streaks of ink spreading in liquid. Off near the drop, which starts clean.
      const mx = Math.min(W - 1, Math.max(0, Math.round(x + (flow[p] / 255 - 0.5) * 2 * MARBLE_WARP_PX)))
      const my = Math.min(h - 1, Math.max(0, Math.round(y + (flow[p + 1] / 255 - 0.5) * 2 * MARBLE_WARP_PX)))
      const marble = Math.min(1, (streak[(my * W + mx) * 4] / 255) * 1.8) - 0.5
      body[i] = d + TEAR * (tear[p] / 255 - 0.5) + MARBLE * marble * near
      wisp[i] = body[i] - VEIN * ridge // same marbled edge, only the thin ridges reach ahead
    }
  }

  // All frames in one sprite grid: one image to load, and the animation only moves it.
  // (Swapping a separate image per frame left the mask empty while each one loaded.)
  const sprite = new OffscreenCanvas(W * COLS, h * ROWS)
  const ctx = sprite.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  const frame = ctx.createImageData(W, h)
  for (let k = 0; k < FRAMES; k++) {
    const front = ease(k / (FRAMES - 1))
    for (let i = 0; i < body.length; i++) {
      const solid = Math.max(0, Math.min(1, (front - body[i]) * EDGE))
      const faint = Math.max(0, Math.min(1, (front - wisp[i]) * WISP_EDGE)) * WISP_ALPHA
      frame.data[i * 4 + 3] = Math.max(solid, faint) * 255
    }
    ctx.putImageData(frame, (k % COLS) * W, Math.floor(k / COLS) * h)
  }
  // A data URL, not a blob URL: the view-transition mask never painted a blob: image in time.
  const url = await toDataUrl(await sprite.convertToBlob({ type: 'image/png' }))
  // Keep the sprite loaded as a CSS image, so the mask is there on the transition's first frame.
  keepLoaded(url)
  const img = new Image()
  img.src = url
  await img.decode()
  const at = (k: number) => {
    const pos = `${((k % COLS) / (COLS - 1)) * 100}% ${(Math.floor(k / COLS) / (ROWS - 1)) * 100}%`
    return `mask-position: ${pos}; -webkit-mask-position: ${pos};`
  }
  // One keyframe per frame; steps(1) makes each jump straight to its cell instead of sliding.
  const steps = Array.from({ length: FRAMES }, (_, k) => `${((k / (FRAMES - 1)) * 100).toFixed(3)}% { ${at(k)} animation-timing-function: steps(1, end); }`).join('\n')
  const css = `@keyframes ink-wash {\n${steps}\n}
::view-transition-new(root) { mask-image: url("${url}"); -webkit-mask-image: url("${url}"); mask-size: ${COLS * 100}% ${ROWS * 100}%; -webkit-mask-size: ${COLS * 100}% ${ROWS * 100}%; mask-repeat: no-repeat; -webkit-mask-repeat: no-repeat; ${at(0)} animation: ink-wash ${DURATION_MS}ms linear both; }`
  return { url, css, size: `${innerWidth}x${innerHeight}` }
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

/** A hidden element that holds the sprite as a mask, so the browser keeps it decoded. */
function keepLoaded(url: string) {
  let holder = document.getElementById('ink-preload')
  if (!holder) {
    holder = document.createElement('div')
    holder.id = 'ink-preload'
    holder.setAttribute('aria-hidden', 'true')
    holder.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;background:#000'
    document.body.append(holder)
  }
  holder.style.maskImage = holder.style.webkitMaskImage = `url("${url}")`
}

/** Draw a wash in idle time, starting from the theme button. With `isFresh`, a new one replaces
 *  the current wash when done (new noise each time); until then the current one is reused. */
export function prepareInk(button: HTMLElement | null, isFresh = false) {
  if ((ready && !isFresh) || preparing || !button || !document.startViewTransition || typeof OffscreenCanvas === 'undefined') return
  preparing = true
  const box = button.getBoundingClientRect()
  const run = () =>
    build(box.left + box.width / 2, box.top + box.height / 2)
      .then((wash) => (ready = wash))
      .catch(() => undefined) // keep whatever wash we had; without one the switch is simply instant
      .finally(() => (preparing = false))
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2000 })
  else setTimeout(run, 200)
}

let isRunning = false

/** Switch theme; the ink wash runs if one is drawn, otherwise the switch is instant. */
export function switchTheme(next: Theme, button: HTMLElement | null) {
  const isStill = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const wash = ready
  if (isStill || !wash || isRunning || !document.startViewTransition) {
    apply(next)
    return
  }
  if (wash.size !== `${innerWidth}x${innerHeight}`) {
    // The window changed shape since the frames were drawn: switch now, draw for the new size.
    ready = null
    apply(next)
    prepareInk(button)
    return
  }
  isRunning = true
  const style = document.createElement('style')
  style.textContent = wash.css
  document.head.append(style)
  const transition = document.startViewTransition(() => apply(next))
  transition.finished.finally(() => {
    style.remove()
    isRunning = false
    prepareInk(button, true) // fresh noise for later; this wash serves any click until then
  })
}
