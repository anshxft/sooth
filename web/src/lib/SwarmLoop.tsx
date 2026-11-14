// Fig 2, the job loop: how Swarm Contractor buys one job, drawn as an isometric machine.
// Budget vault → three sealed bids rise → award by price ÷ reputation (the cheapest bid can lose) →
// pay coin moves into escrow → the deliverable goes to review → either paid, or disputed to the SOOTH
// jury, the bond slashed back into the budget, the worker banned and the job re-bought.
import * as k from './iso-kit'
import { along, ease } from './iso-kit-extra'
import { IsoFigure, type Query } from './IsoFigure'

const W = 720
const H = 340
const PLATE = { x: -155, y: -50, w: 310, d: 100, r: 8 }
const VAULT: k.Plane = [-125, 0]
const COINS = 4
const WORKERS = [
  { name: 'A', y: -26, price: 6, rep: 1.0 },
  { name: 'B', y: 0, price: 4, rep: 0.6 },
  { name: 'C', y: 26, price: 5, rep: 1.5 },
]
const WX = -62
const POD_H = 20
const ESCROW: k.Plane = [5, 0]
const ESCROW_H = 14
const REVIEW: k.Plane = [62, 0]
const JURY: k.Plane = [120, 0]
const CYCLE = 14
const STILL_AT = 13

const byScore = WORKERS.map((w, i) => ({ i, score: w.price / w.rep })).sort((a, b) => a.score - b.score)
const WIN = byScore[0].i // C: 5 ÷ 1.5
const NEXT = byScore[1].i // A: 6 ÷ 1.0 (B bid lowest but its record weighs it down)
const CHEAPEST = WORKERS.reduce((m, w, i) => (w.price < WORKERS[m].price ? i : m), 0)
const SCENES = ['accepted job', 'disputed job']

const P = k.fitProjection([...k.boxCorners(PLATE, -10, 0), [WX, 0, POD_H + 26], [VAULT[0], 0, 40]], W, H, { pad: 28, azimuth: 40 })
const S = (paths: k.SolidPaths, style?: k.SolidStyle) => k.solidSvg(paths, style)
const L = (d: string, style?: k.LineStyle) => k.lineSvg(d, style)
const text = (at: k.Plane, label: string) => k.faceTextSvg(k.topMatrix(at, 0, P), label, { size: 6, tone: 'mid' })
const depth = (y: number, x: number) => k.depthOf([x, y, 0], P)

function base(): string {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -10, 10, P)}"/>`]
  out.push(S(k.slabOf(PLATE, -10, 10, P, 8, 1.4), { tone: 'mid' }))
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: 'faint' }))
  out.push(L(k.corners(PLATE, 10).map(([x, y]) => k.ring(x, y, 2, 0, P, 16)).join(''), { tone: 'lo' }))
  out.push(L(k.lineOnTop([VAULT[0] + 22, 0], [JURY[0] - 16, 0], 0.4, P), { tone: 'lo', flow: true }))
  out.push(text([VAULT[0] - 18, 30], 'BUDGET'), text([WX - 12, 42], 'BIDS'), text([ESCROW[0] - 16, 26], 'ESCROW'))
  out.push(text([REVIEW[0] - 16, 26], 'REVIEW'), text([JURY[0] - 12, 26], 'JURY'))
  // the vault: a capped budget the contractor can spend only inside
  out.push(S(k.slabOf({ x: VAULT[0] - 18, y: -20, w: 36, d: 40, r: 3 }, 0, 10, P, 6, 0.6), { tone: 'mid' }))
  out.push(L(k.planOutline({ x: VAULT[0] - 14, y: -16, w: 28, d: 32, r: 2 }, 10, P), { tone: 'faint' }))
  for (let i = 0; i < COINS - 1; i++) out.push(coin(VAULT, 10 + i * 2.6))
  return out.join('')
}

const coin = ([x, y]: k.Plane, z: number) => S(k.cylinder(x, y, 6, z, 2.4, P, 32, 0.3), { tone: 'hi', crease: 'lo', lit: true })
const pod = (y: number) =>
  S(k.cylinder(WX, y, 8, 0, POD_H, P, 32, 0.6), { tone: 'mid' }) + L(k.ring(WX, y, 6, POD_H, P, 32), { tone: 'lo' })
const lid = (y: number) => S(k.cylinder(WX, y, 8.8, POD_H, 2.6, P, 32, 0.4), { tone: 'hi', crease: 'lo' })
const bid = (y: number, price: number) =>
  S(k.slabOf({ x: WX - 4, y: y - 4, w: 8, d: 8, r: 1 }, POD_H - price * 3, price * 3, P, 3, 0.4), { tone: 'hi', crease: 'lo' })

function stations(): string {
  const out = [S(k.slabOf({ x: ESCROW[0] - 15, y: -15, w: 30, d: 30, r: 3 }, 0, ESCROW_H, P, 6, 0.6), { tone: 'mid' })]
  out.push(L(k.lineOnTop([ESCROW[0] - 7, 0], [ESCROW[0] + 7, 0], ESCROW_H, P), { tone: 'hi' }))
  out.push(S(k.slabOf({ x: REVIEW[0] - 15, y: -15, w: 30, d: 30, r: 3 }, 0, 4, P, 6, 0.4), { tone: 'mid' }))
  out.push(`<g data-part="jury">`)
  for (let i = 0; i < 5; i++) {
    const a = (i / 4 - 0.5) * Math.PI * 0.9
    out.push(S(k.cylinder(JURY[0] + Math.cos(a) * 12 - 6, Math.sin(a) * 14, 3.6, 0, 8, P, 20, 0.3), { tone: 'mid' }))
  }
  out.push(`</g>`)
  return out.join('')
}

const doc = () =>
  S(k.slabOf({ x: -6, y: -8, w: 12, d: 16, r: 1 }, 0, 1.6, P, 3), { tone: 'hi', crease: 'none' }) +
  L([-4, 0, 4].map((dy) => k.lineOnTop([-3.5, dy], [3.5, dy], 1.7, P)).join(''), { tone: 'lo' })

const SVG = k.figureSvg({
  width: W,
  height: H,
  label: 'A job machine: a budget vault, three sealed bids, an escrow box, a review plate and a five-agent jury.',
  body: [
    base(),
    ...WORKERS.map((w, i) => ({ w, i })).sort((a, b) => depth(a.w.y, WX) - depth(b.w.y, WX)).map(({ w, i }) =>
      `<g data-part="worker${i}" class="sl-worker">${pod(w.y)}<g data-part="bid${i}">${bid(w.y, w.price)}</g><g data-part="lid${i}">${lid(w.y)}</g></g>`),
    stations(),
    `<g data-part="bond">${coin([0, 0], 0)}</g>`,
    `<g data-part="pay">${coin([0, 0], 0)}</g>`,
    `<g data-part="doc">${doc()}</g>`,
  ],
})

const pos = (x: number, y: number, z: number): k.Point3 => [x, y, z]
const win = WORKERS[WIN]
const next = WORKERS[NEXT]

function draw(q: Query, t: number, scene: number): string {
  const disputed = scene === 1
  const open = ease((t - 1.5) / 1.2)
  WORKERS.forEach((_, i) => {
    q(`lid${i}`).setAttribute('transform', k.translateAlong(P, [0, 0, open * 12]))
    q(`bid${i}`).setAttribute('transform', k.translateAlong(P, [0, 0, open * WORKERS[i].price * 3]))
    const worker = q(`worker${i}`)
    worker.toggleAttribute('data-win', (t >= 3 && i === WIN && !(disputed && t >= 10)) || (disputed && t >= 10.5 && i === NEXT))
    worker.toggleAttribute('data-out', disputed && t >= 9 && i === WIN)
  })
  const vaultTop = pos(VAULT[0], 0, 10 + (COINS - 1) * 2.6)
  const escrowTop = pos(ESCROW[0], 0, ESCROW_H)
  const winTop = pos(WX, win.y, POD_H + 16)
  const toEscrow = ease((t - 4) / 1.2)
  const payBack = disputed ? ease((t - 9) / 1.2) : 0
  const paid = disputed ? 0 : ease((t - 7.5) / 1.2)
  let pay = along(vaultTop, escrowTop, toEscrow, 24)
  if (paid > 0) pay = along(escrowTop, winTop, paid, 24)
  if (payBack > 0) pay = along(escrowTop, vaultTop, payBack, 24)
  q('pay').setAttribute('transform', k.translateAlong(P, pay))

  // the winner's bond: sits on its pod, and in a dispute is slashed into the budget
  const bondOn = pos(WX, win.y, POD_H + 2.6 + 12)
  const slash = disputed ? ease((t - 9.3) / 1.2) : 0
  q('bond').setAttribute('transform', k.translateAlong(P, along(bondOn, pos(VAULT[0], 0, vaultTop[2] + 2.6), slash, 30)))
  q('bond').style.opacity = t >= 3 ? '1' : '0'

  const deliver = ease((t - 5.6) / 1.2)
  const toJury = disputed ? ease((t - 7.4) / 1.0) : 0
  const reviewTop = pos(REVIEW[0], 0, 4)
  let d = along(pos(WX, win.y, POD_H + 4), reviewTop, deliver, 22)
  if (toJury > 0) d = along(reviewTop, pos(JURY[0] - 6, 0, 8), toJury, 16)
  q('doc').setAttribute('transform', k.translateAlong(P, d))
  q('doc').style.opacity = deliver > 0 && !(disputed && t >= 10) ? '1' : '0'
  q('jury').toggleAttribute('data-hot', disputed && t >= 8.4 && t < 10.5)

  if (t < 1.5) return 'sealed bids · every worker locks a bond'
  if (t < 3) return `bids open · ${WORKERS.map((w) => `${w.name} ${w.price} Ⓝ`).join(', ')}`
  if (t < 4) return `${WORKERS[CHEAPEST].name} bid lowest, but ${win.name} wins on price ÷ reputation`
  if (t < 5.6) return `escrow · the contract holds ${win.price} Ⓝ for ${win.name}`
  if (t < 7.4) return `${win.name} delivers · the contractor reviews it`
  if (!disputed) return t < 8.7 ? 'accepted · the contract pays' : `paid on chain · ${win.price} Ⓝ to ${win.name}, bond returned`
  if (t < 9) return 'disputed · the SOOTH jury rules on the work'
  if (t < 10.5) return `rejected · ${win.name}'s bond slashed back into the budget`
  return `${win.name} banned · the job is re-bought from ${next.name}`
}

export function SwarmLoop() {
  return (
    <IsoFigure fig="Fig 2" title="How the swarm buys a job" label="Job loop." svg={SVG}
      scenes={SCENES} cycle={CYCLE} stillAt={STILL_AT} css={SL_CSS} draw={draw} />
  )
}

const SL_CSS = `
.sl-worker[data-win] .iso-edge{stroke:var(--anatomy-lit)}
.sl-worker[data-win] .iso-top{fill:var(--anatomy-lit-top)}
.sl-worker[data-out] .iso-edge{stroke:var(--anatomy-red)}
[data-part="jury"][data-hot] .iso-edge{stroke:var(--anatomy-red)}
`
