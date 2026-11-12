// Off-chain evidence: the labelled dispute benchmark (agents/bench-disputes.mts) and the market
// simulation (contracts/swarm/examples/market.rs). Both scripts write the JSON this page imports.
import { Scramble } from '../lib/motion'
import { cn } from '../lib/utils'
import disputes from '../data/disputes.json'
import market from '../data/market.json'

const REPO = 'https://github.com/anshxft/sooth/blob/main'
const MALLORY = { answer: 'YES', confidence: 99 } // the bribed juror's vote in every case
const MANIPULATION = new Set(['fake-claim', 'injection-hidden', 'injection-visible', 'injection-json'])
const CHART = { w: 640, h: 240, padL: 36, padR: 172, padT: 12, padB: 24 }
const SELLER_STYLE: Record<string, string> = {
  'honest-cheap': 'stroke-ink',
  cheater: 'stroke-red',
  flaky: 'stroke-muted',
}

type Dispute = (typeof disputes)[number]
const isRight = (d: Dispute) => d.jury.winner === d.label
const share = (n: number, d: number) => `${Math.round((100 * n) / d)}%`

export function Benchmark() {
  const auto = disputes.filter((d) => d.jury.isConfident)
  const tricks = disputes.filter((d) => MANIPULATION.has(d.kind))
  const cheater = market.sellers.find((s) => s.name === 'cheater')
  return (
    <main className="mx-auto max-w-[1440px] p-4">
      <section className="blueprint grid-cols-12" aria-labelledby="bench-title">
        <div className="col-span-12 flex flex-wrap items-end justify-between gap-4 p-4">
          <div>
            <h1 id="bench-title" className="font-display text-[clamp(3rem,9vw,7rem)] leading-[0.9] tracking-[-0.04em]"><Scramble text="benchmark" /></h1>
            <p className="mt-2 max-w-xl text-muted">
              Does the jury rule right when a worker cheats, and does cheating pay? Two experiments, both reproducible from the repo.
            </p>
          </div>
        </div>

        <Stat label="Jury correct" value={share(disputes.filter(isRight).length, disputes.length)} note={`${disputes.filter(isRight).length} of ${disputes.length} disputes`} />
        <Stat label="Correct when auto-resolved" value={share(auto.filter(isRight).length, auto.length)} note={`${auto.length} settled in round 1`} />
        <Stat label="Manipulation caught" value={`${tricks.filter(isRight).length}/${tricks.length}`} note="fake claim + 3 injections" />
        <Stat label="Cheater's PnL" value={cheater ? cheater.pnl.toFixed(2) : '—'} unit="Ⓝ" note={`over ${market.jobs} simulated jobs`} isRed />

        <div className="col-span-12 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-2xl">01 · Disputes</h2>
            <a href={`${REPO}/benchmark/DISPUTES.md`} target="_blank" rel="noopener noreferrer" className="label hover:underline">benchmark/DISPUTES.md ↗</a>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            {disputes.length} labelled job disputes, each judged by the four honest juror models. In every case the bribed juror <b className="text-ink">mallory</b> also votes {MALLORY.answer} at {MALLORY.confidence}, and the SOOTH tally decides.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="label text-left text-muted">
                  <th className="py-2 pr-3 font-normal">Case</th><th className="pr-3 font-normal">Kind</th><th className="pr-3 font-normal">Truth</th>
                  <th className="pr-3 font-normal">Jury</th><th className="font-normal">Votes (4 honest + mallory)</th>
                </tr>
              </thead>
              <tbody>{disputes.map((d) => <DisputeRow key={d.id} d={d} />)}</tbody>
            </table>
          </div>
          <p className="label mt-3 text-muted">
            Honest limit: a plain prompt with no injection defence did about as well on these cases, so the protection shown here comes from several models plus the stake rule.
          </p>
        </div>

        <div className="col-span-12 p-4 md:col-span-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-2xl">02 · Does cheating pay?</h2>
            <a href={`${REPO}/contracts/swarm/examples/market.rs`} target="_blank" rel="noopener noreferrer" className="label hover:underline">examples/market.rs ↗</a>
          </div>
          <p className="mt-2 text-sm text-muted">
            {market.jobs} jobs, {market.buyers} buyers, winners picked by the contract's own award code, jury accuracy set to the measured 92%. Profit in NEAR after each job.
          </p>
          <PnlChart />
        </div>
        <div className="col-span-12 p-4 md:col-span-4">
          <span className="label text-muted">Sellers</span>
          <table className="mt-2 w-full text-sm">
            <thead><tr className="label text-left text-muted"><th className="py-2 font-normal">Seller</th><th className="text-right font-normal">Jobs</th><th className="text-right font-normal">Rep</th><th className="text-right font-normal">PnL</th></tr></thead>
            <tbody>
              {market.sellers.map((s) => (
                <tr key={s.name} className="border-t border-line">
                  <td className="py-2"><span className="font-semibold">{s.name}</span> <span className="font-mono text-muted">{s.price.toFixed(2)}</span></td>
                  <td className="text-right font-mono">{s.jobs}</td>
                  <td className="text-right font-mono">{s.rep.toFixed(2)}×</td>
                  <td className={cn('text-right font-mono font-semibold', s.pnl < 0 && 'text-red')}>{s.pnl > 0 ? '+' : ''}{s.pnl.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="label mt-3 text-muted">The cheater wins on price until each buyer bans it; the premium and overcharging sellers never win a job.</p>
        </div>
      </section>
    </main>
  )
}

function DisputeRow({ d }: { d: Dispute }) {
  const isOk = isRight(d)
  return (
    <tr className="border-t border-line">
      <td className="py-2 pr-3 font-mono">{d.id}</td>
      <td className="pr-3 text-muted">{d.kind}</td>
      <td className="pr-3 font-mono">{d.label}</td>
      <td>
        <span className={cn('label border border-ink px-1.5 py-0.5', isOk ? 'bg-ink text-canvas' : 'bg-red/10')}>
          {isOk ? '✓' : '✗'} {d.jury.winner} · {d.jury.isConfident ? 'auto' : 'round 2'}
        </span>
      </td>
      <td>
        <div className="flex flex-wrap gap-1">
          {d.votes.map((v) => <Vote key={v.juror} who={v.juror} answer={v.answer} confidence={v.confidence} isRight={v.answer === d.label} />)}
          <Vote who="mallory" answer={MALLORY.answer} confidence={MALLORY.confidence} isRight={MALLORY.answer === d.label} isBribed />
        </div>
      </td>
    </tr>
  )
}

function Vote({ who, answer, confidence, isRight, isBribed = false }: { who: string; answer: string; confidence: number; isRight: boolean; isBribed?: boolean }) {
  return (
    <span title={`${who}: ${answer} at ${confidence}%`} className={cn('font-mono text-[11px] border px-1', isRight ? 'border-line' : 'border-red text-red', isBribed && 'border-dashed')}>
      {who.slice(0, 3)} {answer.slice(0, 3)} {confidence}
    </span>
  )
}

function PnlChart() {
  const values = market.points.flatMap((p) => p.pnl)
  const [lo, hi] = [Math.min(0, ...values), Math.max(...values)]
  const x = (job: number) => CHART.padL + ((job - 1) / (market.jobs - 1)) * (CHART.w - CHART.padL - CHART.padR)
  const y = (v: number) => CHART.padT + ((hi - v) / (hi - lo)) * (CHART.h - CHART.padT - CHART.padB)
  const visible = market.sellers.map((s, i) => ({ ...s, i })).filter((s) => s.jobs > 0)
  return (
    <svg viewBox={`0 0 ${CHART.w} ${CHART.h}`} className="wipe mt-3 w-full" role="img" aria-label={`Profit over ${market.jobs} jobs: ${visible.map((s) => `${s.name} ${s.pnl.toFixed(2)} NEAR`).join(', ')}`}>
      <line x1={CHART.padL} x2={CHART.w - CHART.padR} y1={y(0)} y2={y(0)} className="stroke-line" />
      {[lo, hi].map((v) => <text key={v} x={CHART.padL - 6} y={y(v) + 3} textAnchor="end" className="fill-muted font-mono text-[11px]">{v.toFixed(0)}</text>)}
      <text x={CHART.padL - 6} y={y(0) + 3} textAnchor="end" className="fill-muted font-mono text-[11px]">0</text>
      {[1, market.jobs].map((j) => <text key={j} x={x(j)} y={CHART.h - 6} textAnchor={j === 1 ? 'start' : 'end'} className="fill-muted font-mono text-[11px]">job {j}</text>)}
      {visible.map((s) => (
        <g key={s.name}>
          <polyline fill="none" strokeWidth={s.name === 'honest-cheap' ? 2 : 1.5} vectorEffect="non-scaling-stroke" className={SELLER_STYLE[s.name] ?? 'stroke-muted'}
            points={market.points.map((p) => `${x(p.job)},${y(p.pnl[s.i])}`).join(' ')} />
          <text x={x(market.jobs) + 6} y={y(s.pnl) + 3} className={cn('font-mono text-[12px]', s.pnl < 0 ? 'fill-red' : 'fill-ink')}>{s.name} {s.pnl > 0 ? '+' : ''}{s.pnl.toFixed(1)}</text>
        </g>
      ))}
    </svg>
  )
}

function Stat({ label, value, unit, note, isRed = false }: { label: string; value: string; unit?: string; note: string; isRed?: boolean }) {
  return (
    <div className="col-span-6 p-4 md:col-span-3">
      <div className="label text-muted">{label}</div>
      <div className={cn('mt-1 font-display text-3xl', isRed && 'text-red')}>
        <Scramble text={value} />{unit && <span className="ml-1.5 font-sans text-base">{unit}</span>}
      </div>
      <div className="mt-1 text-xs text-muted">{note}</div>
    </div>
  )
}
