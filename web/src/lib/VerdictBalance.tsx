// Fig 1, the verdict balance: how one SOOTH round settles, drawn as an isometric machine.
// Five sealed pods (commit) open (reveal), their answers drop on a balance (tally), and a dial reads the
// winning share against the 80% line. Click to switch between a confident round and one that is not.
// The whole state is a pure function of time, so reduced motion simply shows one settled frame.
import * as k from './iso-kit'
import { along, ease } from './iso-kit-extra'
import { IsoFigure, type Query } from './IsoFigure'

const W = 720
const H = 340
const PLATE = { x: -150, y: -46, w: 300, d: 92, r: 8 }
const PODS = [-125, -100, -75, -50, -25]
const POD_R = 8
const POD_H = 14
const POST: k.Plane = [60, 0]
const BEAM_Z = 62
const ARM = 30
const TRAY_Z = 30
const DIAL: k.Plane = [128, 24]
const DIAL_R = 15
const DIAL_Z = 6
const LINE = 0.8 // contract: auto_share_bps 8000
const CYCLE = 12
const STILL_AT = 8

const SCENARIOS: { answers: boolean[]; name: string }[] = [
  { answers: [true, true, false, true, true], name: 'confident round' },
  { answers: [true, false, true, false, true], name: 'split round' },
]

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -10, 0), [POST[0], 0, BEAM_Z + 8], [POST[0] - ARM, 0, TRAY_Z - 12], [POST[0] + ARM, 0, TRAY_Z - 12]],
  W, H, { pad: 28, azimuth: 40 },
)
const S = (paths: k.SolidPaths, style?: k.SolidStyle) => k.solidSvg(paths, style)
const L = (d: string, style?: k.LineStyle) => k.lineSvg(d, style)

function base(): string {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -10, 10, P)}"/>`]
  out.push(S(k.slabOf(PLATE, -10, 10, P, 8, 1.4), { tone: 'mid' }))
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: 'faint' }))
  const screws = k.corners(PLATE, 10)
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2, 0, P, 16)).join(''), { tone: 'lo' }))
  out.push(S(k.slabOf({ x: -138, y: -12, w: 128, d: 24, r: 3 }, 0, 2, P, 4), { tone: 'lo', crease: 'none' }))
  out.push(L(k.lineOnTop([-8, 0], [POST[0] - ARM - 14, 0], 0.4, P), { tone: 'lo', flow: true }))
  out.push(k.faceTextSvg(k.topMatrix([-138, 26], 0, P), 'COMMIT · REVEAL', { size: 6, tone: 'mid' }))
  out.push(k.faceTextSvg(k.topMatrix([POST[0] - 36, 40], 0, P), 'TALLY', { size: 6, tone: 'mid' }))
  out.push(k.faceTextSvg(k.topMatrix([DIAL[0] - 16, DIAL[1] - 20], 0, P), 'SHARE', { size: 6, tone: 'mid' }))
  return out.join('')
}

const pod = (x: number) =>
  S(k.cylinder(x, 0, POD_R, 2, POD_H - 2, P, 32, 0.6), { tone: 'mid' }) + L(k.ring(x, 0, POD_R - 2, POD_H, P, 32), { tone: 'lo' })
const lid = (x: number) =>
  S(k.cylinder(x, 0, POD_R + 0.8, POD_H, 3, P, 32, 0.5), { tone: 'hi', crease: 'lo' }) +
  L(k.knurl(x, 0, POD_R + 0.8, POD_H, POD_H + 3, 40, P, 0.3), { tone: 'faint' })
const weight = (yes: boolean) =>
  S(k.slabOf({ x: -4, y: -4, w: 8, d: 8, r: 1 }, 0, 7, P, 3, 0.4), { tone: 'hi', crease: 'lo', lit: yes })

const balance = () =>
  S(k.cylinder(POST[0], 0, 7, 0, 3, P, 28), { tone: 'mid' }) +
  S(k.cylinder(POST[0], 0, 2.6, 3, BEAM_Z - 3, P, 24), { tone: 'mid', crease: 'none' }) +
  S(k.cylinder(POST[0], 0, 3.6, BEAM_Z - 1, 3, P, 24), { tone: 'hi' })
const tray = (label: string) =>
  S(k.slabOf({ x: -13, y: -13, w: 26, d: 26, r: 3 }, -3, 3, P, 6, 0.4), { tone: 'mid' }) +
  L(k.planOutline({ x: -10, y: -10, w: 20, d: 20, r: 2 }, 0, P), { tone: 'faint' }) +
  k.faceTextSvg(k.topMatrix([-12, 20], -3, P), label, { size: 5, tone: 'mid' })

function dial(): string {
  const [x, y] = DIAL
  const out = [S(k.cylinder(x, y, DIAL_R, 0, DIAL_Z, P, 64, 0.6), { tone: 'hi', crease: 'lo' })]
  const ticks = k.radialTicks(x, y, DIAL_R - 2.5, 20, 5, DIAL_Z, [1.2, 2.6], P)
  out.push(L(ticks.minor, { tone: 'lo' }), L(ticks.major, { tone: 'mid' }))
  const a = LINE * Math.PI * 2
  out.push(L(k.lineOnTop([x + Math.sin(a) * (DIAL_R - 6), y - Math.cos(a) * (DIAL_R - 6)], [x + Math.sin(a) * DIAL_R, y - Math.cos(a) * DIAL_R], DIAL_Z + 0.1, P), { tone: 'red' }))
  out.push(L(k.ring(x, y, 1.4, DIAL_Z, P, 16), { tone: 'mid' }))
  return out.join('')
}
const needleAt = (share: number) => {
  const a = share * Math.PI * 2
  const [x, y] = DIAL
  return k.lineOnTop([x, y], [x + Math.sin(a) * (DIAL_R - 3.5), y - Math.cos(a) * (DIAL_R - 3.5)], DIAL_Z + 0.2, P)
}

/** Where each part is at time t (seconds into the cycle). */
function stateAt(t: number, answers: boolean[]) {
  let landedYes = 0
  let landedNo = 0
  const parts = answers.map((yes, i) => {
    const open = ease((t - 1.6 - i * 0.25) / 0.8)
    const fly = ease((t - 3.6 - i * 0.35) / 0.9)
    if (fly >= 1) { if (yes) landedYes++; else landedNo++ }
    return { yes, i, open, fly, slot: answers.slice(0, i).filter((b) => b === yes).length }
  })
  const n = answers.length
  const yesCount = answers.filter(Boolean).length
  const winnerShare = Math.max(yesCount, n - yesCount) / n
  return {
    parts,
    tilt: (landedYes - landedNo) / n, // YES side down when positive
    needle: winnerShare * ease((t - 6.2) / 1.2),
    settled: t >= 7.4,
    winnerShare,
    yesWins: yesCount * 2 > n,
  }
}

function caption(t: number, s: ReturnType<typeof stateAt>): string {
  if (t < 1.6) return 'commit · five answers sealed'
  if (t < 3.6) return 'reveal · answers and evidence open'
  if (!s.settled) return 'tally · weighing the answers'
  const pct = Math.round(s.winnerShare * 100)
  return s.winnerShare >= LINE
    ? `${pct}% ≥ 80% · ${s.yesWins ? 'YES' : 'NO'} settles, the wrong stake is slashed`
    : `${pct}% < 80% · not confident, round 2 at double stake`
}

const SVG = k.figureSvg({
  width: W,
  height: H,
  label: 'A balance machine: five sealed pods open, each answer drops as a weight on a YES or NO tray, and a dial reads the winning share against the 80 percent line.',
  body: [
    base(),
    ...PODS.map(pod),
    ...PODS.map((x, i) => `<g data-part="lid${i}">${lid(x)}</g>`),
    dial(),
    `<path data-part="needle" class="iso-line" data-tone="lit" d="${needleAt(0)}" style="stroke-width:1.2"/>`,
    balance(),
    `<path data-part="beam" class="iso-line" data-tone="hi" style="stroke-width:1.4" d=""/>`,
    `<path data-part="hangers" class="iso-line" data-tone="mid" d=""/>`,
    `<g data-part="trayY">${tray('YES')}</g>`,
    `<g data-part="trayN">${tray('NO')}</g>`,
    ...PODS.map((_, i) => `<g data-part="w${i}" class="vb-weight"><g data-yes>${weight(true)}</g><g data-no>${weight(false)}</g></g>`),
  ],
})

function draw(q: Query, t: number, scene: number): string {
  const s = stateAt(t, SCENARIOS[scene].answers)
  const drop = s.tilt * 9
  const yEnd: k.Point3 = [POST[0] - ARM, 0, BEAM_Z - drop]
  const nEnd: k.Point3 = [POST[0] + ARM, 0, BEAM_Z + drop]
  const yTray = TRAY_Z - drop
  const nTray = TRAY_Z + drop
  q('beam').setAttribute('d', k.segment(yEnd, nEnd, P))
  q('hangers').setAttribute('d', [-1, 1].flatMap((side) => [
    k.segment(yEnd, [yEnd[0] + side * 10, side * 10, yTray], P),
    k.segment(nEnd, [nEnd[0] + side * 10, side * 10, nTray], P),
  ]).join(''))
  q('trayY').setAttribute('transform', k.translateAlong(P, [yEnd[0], 0, yTray]))
  q('trayN').setAttribute('transform', k.translateAlong(P, [nEnd[0], 0, nTray]))
  for (const p of s.parts) {
    q(`lid${p.i}`).setAttribute('transform', k.translateAlong(P, [0, 0, p.open * 10]))
    const home: k.Point3 = [PODS[p.i], 0, 2 + p.open * 15]
    const dest: k.Point3 = [(p.yes ? yEnd[0] : nEnd[0]) - 6 + (p.slot % 2) * 12, -5 + Math.floor(p.slot / 2) * 10, p.yes ? yTray : nTray]
    const w = q(`w${p.i}`)
    w.setAttribute('transform', k.translateAlong(P, along(home, dest, p.fly, 26)))
    w.toggleAttribute('data-show-yes', p.open > 0.5 && p.yes)
    w.toggleAttribute('data-show-no', p.open > 0.5 && !p.yes)
    w.toggleAttribute('data-out', s.settled && s.winnerShare >= LINE && p.yes !== s.yesWins)
  }
  q('needle').setAttribute('d', needleAt(s.needle))
  return caption(t, s)
}

export function VerdictBalance() {
  return (
    <IsoFigure fig="Fig 1" title="How a question settles" label="Verdict balance." svg={SVG}
      scenes={SCENARIOS.map((s) => s.name)} cycle={CYCLE} stillAt={STILL_AT} css={VB_CSS} draw={draw} />
  )
}

const VB_CSS = `
.vb-weight>g{display:none}
.vb-weight[data-show-yes]>[data-yes],.vb-weight[data-show-no]>[data-no]{display:inline}
.vb-weight[data-out] .iso-edge{stroke:var(--anatomy-red)}
`
