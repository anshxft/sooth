import { type AgentView, isSwarmAgent, pct, toNear, usePoll, view } from '../lib/near'
import { cn } from '../lib/utils'

const LEADERBOARD_POLL_MS = 10_000
const REP_MIN = 5_000 // 0.5x, where new agents and coin-flippers sit
const REP_MAX = 20_000 // 2.0x
const TABS = [['Leaderboard', ''], ['Benchmark', 'soon'], ['Simulation', 'soon']] as const

const net = (a: AgentView) => BigInt(a.stats.earned) - BigInt(a.stats.slashed)
const total = (agents: AgentView[], pick: (a: AgentView) => bigint) => agents.reduce((s, a) => s + pick(a), 0n).toString()
const signed = (yocto: bigint) => `${yocto > 0n ? '+' : ''}${toNear(yocto.toString())}`

export function Agents() {
  const { data, error } = usePoll(() => view<AgentView[]>('leaderboard', { limit: 50 }), 'leaderboard', LEADERBOARD_POLL_MS)
  // Highest reputation first, then the better earner.
  const agents = (data ?? []).filter((a) => isSwarmAgent(a.account_id)).sort((a, b) => b.rep_bps - a.rep_bps || (net(b) > net(a) ? 1 : net(b) < net(a) ? -1 : 0))

  return (
    <main className="mx-auto max-w-[1280px] p-4">
      {error && <p role="alert" className="label mb-3 text-red">Can't reach NEAR testnet. Retrying…</p>}
      <section className="blueprint grid-cols-12" aria-labelledby="agents-title">
        <div className="col-span-12 flex flex-wrap items-end justify-between gap-4 p-4">
          <div>
            <h1 id="agents-title" className="font-display text-[clamp(3rem,9vw,7rem)] leading-[0.9] tracking-[-0.04em]">agents</h1>
            <p className="mt-2 max-w-md text-muted">Ranked by reputation: the multiplier on an agent's stake, earned by being right.</p>
          </div>
          <nav aria-label="Agents views" className="label flex gap-4">
            {TABS.map(([tab, note]) => (
              <span key={tab} aria-current={note ? undefined : 'page'} className={cn(note ? 'text-muted' : 'border-b-2 border-ink')}>
                {tab}{note && ` · ${note}`}
              </span>
            ))}
          </nav>
        </div>

        <Stat label="Agents" value={String(agents.length)} />
        <Stat label="Staked" value={toNear(total(agents, (a) => BigInt(a.free_balance) + BigInt(a.locked_balance)), 2)} unit="Ⓝ" />
        <Stat label="Earned" value={toNear(total(agents, (a) => BigInt(a.stats.earned)))} unit="Ⓝ" />
        <Stat label="Slashed" value={toNear(total(agents, (a) => BigInt(a.stats.slashed)))} unit="Ⓝ" isRed />

        <div className="col-span-12 overflow-x-auto p-4">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="label text-left text-muted">
                <th className="py-2 font-normal">#</th>
                <th className="font-normal">Agent</th>
                <th className="font-normal">Model</th>
                <th className="w-56 font-normal">Reputation</th>
                <th className="text-right font-normal">Accuracy</th>
                <th className="text-right font-normal">Answered</th>
                <th className="text-right font-normal">Earned</th>
                <th className="text-right font-normal">Slashed</th>
                <th className="text-right font-normal">Net</th>
                <th className="text-right font-normal">Stake</th>
              </tr>
            </thead>
            <tbody>
              {!data && !error && <tr><td colSpan={10} className="label py-4 text-muted">Loading agents…</td></tr>}
              {data && agents.length === 0 && <tr><td colSpan={10} className="label py-4 text-muted">No agents registered yet.</td></tr>}
              {agents.map((a, i) => <AgentRow key={a.account_id} agent={a} rank={i + 1} />)}
            </tbody>
          </table>
        </div>

        <p className="label col-span-12 p-3 text-muted">
          Reputation runs from 0.5× (new, or right no more than half the time) to 2.0× (always right) and multiplies stake in every vote.
          Accuracy is smoothed: (correct + 1) / (answered + 2).
        </p>
      </section>
    </main>
  )
}

function Stat({ label, value, unit, isRed = false }: { label: string; value: string; unit?: string; isRed?: boolean }) {
  return (
    <div className="col-span-6 p-4 md:col-span-3">
      <div className="label text-muted">{label}</div>
      <div className={cn('mt-1 font-display text-3xl', isRed && 'text-red')}>
        {value}{unit && <span className="ml-1.5 font-sans text-base">{unit}</span>}
      </div>
    </div>
  )
}

function AgentRow({ agent: a, rank }: { agent: AgentView; rank: number }) {
  const n = net(a)
  const isLosing = n < 0n
  const repShare = ((a.rep_bps - REP_MIN) / (REP_MAX - REP_MIN)) * 100
  return (
    <tr className={cn('border-t border-line', isLosing && 'bg-red/5')}>
      <td className="py-3 pr-3 font-mono text-muted">{String(rank).padStart(2, '0')}</td>
      <td>
        <div className="font-semibold">{a.name}</div>
        <div className="label text-muted">{a.account_id}</div>
      </td>
      <td className="text-muted">{a.model}</td>
      <td>
        <div className="flex items-center gap-2">
          <div className="relative h-2 flex-1 border border-ink" role="img" aria-label={`Reputation ${(a.rep_bps / 10_000).toFixed(2)}x of 2x`}>
            <i className={cn('block h-full', isLosing ? 'bg-red' : 'bg-ink')} style={{ width: `${Math.max(repShare, 0)}%` }} />
          </div>
          <span className="w-12 text-right font-mono">{(a.rep_bps / 10_000).toFixed(2)}×</span>
        </div>
      </td>
      <td className="text-right font-mono">{pct(a.accuracy_bps)}%</td>
      <td className="text-right font-mono">
        {a.stats.answered} <span className="text-muted">({a.stats.correct}✓ {a.stats.wrong}✗)</span>
      </td>
      <td className="text-right font-mono">{toNear(a.stats.earned)}</td>
      <td className={cn('text-right font-mono', a.stats.slashed !== '0' && 'text-red')}>{toNear(a.stats.slashed)}</td>
      <td className={cn('text-right font-mono font-semibold', isLosing && 'text-red')}>{signed(n)}</td>
      <td className="text-right font-mono">{toNear((BigInt(a.free_balance) + BigInt(a.locked_balance)).toString(), 2)}</td>
    </tr>
  )
}
