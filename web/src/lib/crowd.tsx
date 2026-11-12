// A crowd walking across a canvas: many agents, one truth.
// Adapted from Skiper UI "Canvas crowd" (skiper39, free tier, attribution required), itself based on
// codepen.io/zadvorsky/pen/xxwbBQV. Illustrations: Open Peeps (CC0), one sprite sheet of 15 x 7 figures.
import { gsap } from 'gsap'
import { useEffect, useRef } from 'react'
import { isWashing } from './theme'

const SRC = '/peeps/all-peeps.png'
const COLS = 15
const ROWS = 7
const WALK_SECS = 10 // to cross the stage at time scale 1
const STEP_SECS = 0.25 // one bob up or down
const BOB_PX = 10
const FIGURES_PER_STAGE = 1.7 // a figure is stage height / this, at most its natural size

type Peep = {
  sx: number; sy: number; sw: number; sh: number; w: number; h: number
  x: number; y: number; ground: number; scaleX: number; walk: gsap.core.Timeline | null
  art: HTMLCanvasElement | null // the figure pre-scaled for the current size, so frames only copy it
}

const rand = (min: number, max: number) => min + Math.random() * (max - min)

export function Crowd({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const isStill = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const img = new Image()
    const stage = { w: 0, h: 0 }
    const all: Peep[] = []
    const idle: Peep[] = []
    const crowd: Peep[] = []

    const render = () => {
      if (isWashing()) return // hold the frame while the theme's ink wash runs over the page
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.save()
      ctx.scale(devicePixelRatio, devicePixelRatio)
      for (const p of crowd) {
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.scale(p.scaleX, 1)
        if (p.art) ctx.drawImage(p.art, 0, 0, p.w, p.h)
        ctx.restore()
      }
      ctx.restore()
    }

    const join = (): Peep => {
      const p = idle.splice(Math.floor(Math.random() * idle.length), 1)[0]
      const toRight = Math.random() > 0.5
      const startY = stage.h - p.h + (100 - 250 * gsap.parseEase('power2.in')(Math.random())) * (p.h / p.sh)
      const [startX, endX] = toRight ? [-p.w, stage.w] : [stage.w + p.w, 0]
      Object.assign(p, { x: startX, y: startY, ground: startY, scaleX: toRight ? 1 : -1 })
      p.walk = gsap.timeline({ onComplete: () => { leave(p); join() } })
        .timeScale(rand(0.5, 1.5))
        .to(p, { duration: WALK_SECS, x: endX, ease: 'none' }, 0)
        .to(p, { duration: STEP_SECS, repeat: WALK_SECS / STEP_SECS, yoyo: true, y: startY - BOB_PX }, 0)
      crowd.push(p)
      // Depth by where each figure stands, not where its bob has it this frame: sorting by the bobbing
      // y swapped neighbours in front of each other whenever someone joined.
      crowd.sort((a, b) => a.ground - b.ground)
      return p
    }
    const leave = (p: Peep) => {
      crowd.splice(crowd.indexOf(p), 1)
      idle.push(p)
    }

    const reset = () => {
      stage.w = canvas.clientWidth
      stage.h = canvas.clientHeight
      canvas.width = stage.w * devicePixelRatio
      canvas.height = stage.h * devicePixelRatio
      const scale = Math.min(1, stage.h / FIGURES_PER_STAGE / (all[0]?.sh ?? 1))
      for (const p of all) {
        Object.assign(p, { w: p.sw * scale, h: p.sh * scale })
        const art = p.art ?? document.createElement('canvas')
        art.width = Math.ceil(p.w * devicePixelRatio)
        art.height = Math.ceil(p.h * devicePixelRatio)
        art.getContext('2d')?.drawImage(img, p.sx, p.sy, p.sw, p.sh, 0, 0, art.width, art.height)
        p.art = art
      }
      for (const p of crowd) p.walk?.kill()
      crowd.length = 0
      idle.splice(0, idle.length, ...all)
      while (idle.length) join().walk?.progress(Math.random())
      if (isStill) {
        for (const p of crowd) p.walk?.pause()
        render()
      }
    }

    // Draw only while the canvas is on screen.
    const visibility = new IntersectionObserver(([entry]) => {
      if (isStill) return
      if (entry.isIntersecting) gsap.ticker.add(render)
      else gsap.ticker.remove(render)
    })

    img.onload = () => {
      const [w, h] = [img.naturalWidth / COLS, img.naturalHeight / ROWS]
      for (let i = 0; i < COLS * ROWS; i++) all.push({ sx: (i % COLS) * w, sy: Math.floor(i / COLS) * h, sw: w, sh: h, w, h, x: 0, y: 0, ground: 0, scaleX: 1, walk: null, art: null })
      reset()
      visibility.observe(canvas)
    }
    img.src = SRC
    window.addEventListener('resize', reset)

    return () => {
      img.onload = null
      window.removeEventListener('resize', reset)
      visibility.disconnect()
      gsap.ticker.remove(render)
      for (const p of crowd) p.walk?.kill()
    }
  }, [])

  return <canvas ref={ref} className={className} aria-hidden="true" />
}
