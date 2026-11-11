import type { CSSProperties } from 'react'
import { Link } from 'wouter'
import {
  type AgentView, type Answer, type Phase, type QuestionSummary, type QuestionView,
  countdown, isSwarmAgent, pct, qid, toNear, useAgents, useNow, usePoll, view,
} from '../lib/near'
import { cn } from '../lib/utils'
import { Scramble } from '../lib/motion'

const LIVE_PHASES: Phase[] = ['Commit', 'Reveal', 'AwaitingTally', 'Challenge', 'AwaitingFinalize']
const STEPS = ['Commit', 'Reveal', 'Tally', 'Final'] as const
const SLOTS = 5 // agent cells per row on desktop
const STEP_OF: Record<Phase, number> = {
  Scheduled: -1, Commit: 0, Reveal: 1, AwaitingTally: 2, Challenge: 2, AwaitingFinalize: 2, Dao: 2, Finalized: 3, Refunded: 3,
}

export function Arena() {
  const now = useNow()
  const list = usePoll(() => view<QuestionSummary[]>('list_questions', { limit: 20 }), 'list')
  const names = useAgents()
  const summaries = list.data ?? []
  const live = summaries.find((s) => LIVE_PHASES.includes(s.phase)) ?? summaries[0]
  const question = usePoll(
    () => (live ? view<QuestionView>('get_question', { question_id: live.id }) : Promise.resolve(null)),
    `q${live?.id}`,
  )
  // get_question has no phase_ends_at; the list summary does. Smoke-test accounts are left out of the stage.
  const q = question.data && live ? swarmOnly({ ...question.data, phase_ends_at: live.phase_ends_at }) : question.data

  return (
    <main className="mx-auto max-w-[1280px] p-4">
      {list.error && (
        <p role="alert" className="label mb-3 text-red">
          Can't reach NEAR testnet. Retrying…
        </p>
      )}
      <section className="blueprint grid-cols-12" aria-label="Arena">
        <div className="col-span-3 h-16 halftone" aria-hidden="true" />
        <div className="col-span-3 hidden md:block" />
        <div className="col-span-3 hidden place-items-center text-xl md:grid" aria-hidden="true">◎</div>
        <div className="col-span-9 flex items-end justify-end p-3 md:col-span-3">
          <span className="label">{live ? `${qid(live.id)} / ${live.phase}` : 'No questions yet'}</span>
        </div>

        <div className="col-span-12 px-4 pb-2 pt-3">
          <div className="label flex justify-between"><span>✳ Many agents ✦ one truth</span><span>✳</span></div>
          <h1 aria-label="sooth" className="letters text-center font-display text-[clamp(5rem,18vw,15rem)] leading-[0.95] tracking-[-0.05em]">
            {[...'sooth'].map((c, i) => <span key={i} aria-hidden="true" style={{ '--i': i } as CSSProperties}>{c}</span>)}
          </h1>
        </div>

        <div className="col-span-12 p-4 md:col-span-6">
          <p className="text-[clamp(1.4rem,2.6vw,2rem)] font-semibold leading-[1.05] tracking-[-0.04em]">
            Truth, settled by many agents who stake on it.
          </p>
          <p className="mt-3 text-muted">/a prediction-market oracle on NEAR/</p>
        </div>
        <LiveCard q={q} now={now} />
        <AgentLog q={q} names={names} />

        {q && <LiveStage q={q} names={names} now={now} />}
        <QuestionList summaries={summaries} now={now} />

        <footer className="label col-span-12 flex justify-between p-3 text-muted">
          <span>[ Rev 0.1 ]</span>
          <span>Contract sooth.testnet</span>
          <span>Testnet</span>
        </footer>
      </section>
    </main>
  )
}

function LiveCard({ q, now }: { q: QuestionView | null; now: number }) {
  if (!q) return <div className="col-span-12 bg-green! p-4 md:col-span-3"><span className="label">Loading live round…</span></div>
  const lead = leader(q)
  return (
    <Link href={`/q/${q.id}`} className="col-span-12 flex flex-col justify-between gap-3 bg-green! p-4 md:col-span-3">
      <span className={cn('label', q.phase !== 'Finalized' && q.phase !== 'Refunded' && 'live-dot')}>{q.phase} · {countdown(q.phase_ends_at, now) || `round ${q.round}`}</span>
      <Scramble text={q.text} className="font-semibold leading-tight" />
      <span>
        <span className="label flex justify-between"><span>{lead.answer} {pct(lead.bps)}</span><span>auto 80</span></span>
        <Meter bps={lead.bps} />
      </span>
    </Link>
  )
}

function AgentLog({ q, names }: { q: QuestionView | null; names: Map<string, AgentView> }) {
  const round = q?.rounds.at(-1)
  const name = (id: string) => names.get(id)?.name ?? id.split('.')[0]
  const lines = [
    ...(round?.commits ?? []).map((c) => ({ key: `c${c.account_id}`, text: `${name(c.account_id)}.commit ${toNear(c.stake, 1)} Ⓝ`, red: false })),
    ...(round?.reveals ?? []).map((r) => ({ key: `r${r.account_id}`, text: `${name(r.account_id)}.reveal ${r.answer} ${r.confidence}`, red: false })),
    ...(q?.payouts ?? []).filter((p) => p.delta.startsWith('-')).map((p) => ({
      key: `p${p.account_id}${p.round}`, text: `${name(p.account_id)} ${toNear(p.delta)} Ⓝ`, red: true,
    })),
  ]
  return (
    <div className="col-span-12 bg-term! p-4 font-mono text-[11px] uppercase leading-7 tracking-[0.04em] text-term-text md:col-span-3" aria-live="polite">
      <div className="text-green">&gt; agent log</div>
      {lines.length === 0 && <div className="text-[#8a8e8c]">waiting for commits…</div>}
      {lines.slice(-7).map((l) => <div key={l.key} className={cn('log-line', l.red && 'text-red')}>{l.text}</div>)}
      <div className="text-green">&gt; _</div>
    </div>
  )
}

function LiveStage({ q, names, now }: { q: QuestionView; names: Map<string, AgentView>; now: number }) {
  const round = q.rounds.at(-1)!
  const step = STEP_OF[q.phase]
  const lead = leader(q)
  return (
    <div className="col-span-12 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-[clamp(1.4rem,2.8vw,2.2rem)] font-semibold leading-tight tracking-[-0.03em]"><Scramble text={q.text} /></h2>
        <span className="label border border-ink px-2 py-1">{q.category} · {qid(q.id)}</span>
      </div>
      <ol className="blueprint mt-4 grid-cols-4 rounded-none!">
        {STEPS.map((s, i) => (
          <li key={s} className={cn('label p-2', i < step && 'bg-ink! text-canvas', i === step && 'bg-green! live-dot', i > step && 'text-muted')}>
            {s}{i === step && q.phase_ends_at ? ` · ${countdown(q.phase_ends_at, now)}` : ''}
          </li>
        ))}
      </ol>
      <div className="blueprint mt-4 grid-cols-2 rounded-none! md:grid-cols-5">
        {round.commits.map((c, i) => {
          const agent = names.get(c.account_id)
          const reveal = round.reveals.find((r) => r.account_id === c.account_id)
          const payout = q.payouts.find((p) => p.account_id === c.account_id && p.round === round.round)
          const slashed = payout?.delta.startsWith('-')
          return (
            <div key={c.account_id} className={cn('p-3 odd:last:col-span-2 md:odd:last:col-span-1', !reveal && 'bg-term! text-term-text')}>
              <div className="label opacity-70">Unit / {String(i + 1).padStart(2, '0')}</div>
              <div className="font-semibold">{agent?.name ?? c.account_id}</div>
              <div className="text-sm opacity-70">{agent?.model ?? '—'}</div>
              {reveal ? (
                <div className="unseal mt-2 font-display text-2xl">{reveal.answer} {reveal.confidence}</div>
              ) : (
                <div className="sealed label mt-3">▒▒ sealed {c.hash.slice(0, 6)}</div>
              )}
              {payout && (
                <div className={cn('stamp label mt-1', slashed ? 'text-red' : '')}>
                  {slashed ? `✗ slashed ${toNear(payout.delta)}` : `✓ +${toNear(payout.delta)}`} Ⓝ
                </div>
              )}
            </div>
          )
        })}
        {Array.from({ length: Math.max(0, SLOTS - round.commits.length) }, (_, i) => (
          <div key={`empty${i}`} className="hatch min-h-28 opacity-40 odd:last:col-span-2 md:odd:last:col-span-1" aria-hidden="true" />
        ))}
      </div>
      <div className="label mt-4 flex justify-between">
        <span>Weight · {lead.answer} {pct(lead.bps)}</span><span>auto-resolve line 80</span>
      </div>
      <Meter bps={lead.bps} tall />
    </div>
  )
}

function QuestionList({ summaries, now }: { summaries: QuestionSummary[]; now: number }) {
  return (
    <div className="col-span-12 overflow-x-auto p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="label text-left text-muted">
            <th className="py-2 font-normal">ID</th><th className="font-normal">Category</th>
            <th className="font-normal">Question</th><th className="font-normal">Phase / outcome</th>
            <th className="text-right font-normal">Ends</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => (
            <tr key={s.id} className="border-t border-line">
              <td className="py-2 font-mono">{String(s.id).padStart(4, '0')}</td>
              <td>{s.category}</td>
              <td><Link href={`/q/${s.id}`} className="hover:underline">{s.text}</Link></td>
              <td>
                <span className={cn('label border border-ink px-2 py-0.5', s.outcome && 'bg-ink text-canvas', LIVE_PHASES.includes(s.phase) && 'bg-green')}>
                  {s.outcome ? `${s.outcome.answer} · ${s.outcome.resolved_by} · ${pct(s.outcome.share_bps)}` : `${s.phase} · r${s.round}`}
                </span>
              </td>
              <td className="text-right font-mono">{countdown(s.phase_ends_at, now) || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Meter({ bps, tall = false }: { bps: number; tall?: boolean }) {
  return (
    <div className={cn('relative mt-1 overflow-hidden border border-ink bg-canvas', tall ? 'h-3' : 'h-2')} role="img" aria-label={`Leading answer holds ${pct(bps)} percent of weight, auto-resolve at 80`}>
      <span className="hatch absolute inset-0" />
      <i className="fill absolute inset-0 block bg-ink" style={{ transform: `scaleX(${bps / 10_000})` }} />
      <b className="absolute -bottom-1 -top-1 w-[2px] bg-ink" style={{ left: '80%' }} />
    </div>
  )
}

function swarmOnly(q: QuestionView): QuestionView {
  return {
    ...q,
    rounds: q.rounds.map((r) => ({ ...r, commits: r.commits.filter((c) => isSwarmAgent(c.account_id)), reveals: r.reveals.filter((x) => isSwarmAgent(x.account_id)) })),
    payouts: q.payouts.filter((p) => isSwarmAgent(p.account_id)),
  }
}

/** Leading answer of the current round and its share of revealed weight, in basis points. */
export function leader(q: QuestionView): { answer: Answer; bps: number } {
  const reveals = q.rounds.at(-1)?.reveals ?? []
  const totals = new Map<Answer, bigint>()
  for (const r of reveals) totals.set(r.answer, (totals.get(r.answer) ?? 0n) + BigInt(r.weight))
  const all = [...totals.values()].reduce((a, b) => a + b, 0n)
  const [answer, weight] = [...totals].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))[0] ?? ['YES', 0n]
  return { answer, bps: all === 0n ? 0 : Number((weight * 10_000n) / all) }
}
