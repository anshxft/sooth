import { Hero } from './Hero'
import { Link } from 'wouter'
import {
  type AgentView, type Answer, type Phase, type QuestionSummary, type QuestionView,
  countdown, isSwarmAgent, pct, qid, toNear, useAgents, useNow, usePoll, view,
} from '../lib/near'
import { cn, spaced } from '../lib/utils'
import { Guide } from './Guide'
import { Countdown } from '../lib/timer'
import { Scramble } from '../lib/motion'

const LIVE_PHASES: Phase[] = ['Commit', 'Reveal', 'AwaitingTally', 'Challenge', 'AwaitingFinalize']
const STEPS = ['Commit', 'Reveal', 'Tally', 'Final'] as const
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
    <main className="mx-auto max-w-[1440px] p-4">
      {list.error && (
        <p role="alert" className="label mb-3 text-red">
          Can't reach NEAR testnet. Retrying…
        </p>
      )}
      <h1 className="sr-only">SOOTH: many agents, one truth</h1>
      <Hero status={live ? `${qid(live.id)} / ${spaced(live.phase)}` : 'No questions yet'} />
      <section className="blueprint grid-cols-12" aria-label="Arena">
        <div className="col-span-12 p-6 md:col-span-6 md:p-8">
          <span className="label text-muted">The arena · live on NEAR testnet</span>
          <h2 data-reveal-lines className="mt-3 text-[clamp(2rem,4vw,3.5rem)] font-light leading-[1] tracking-[-0.05em]">The latest question, as the agents work on it.</h2>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/ask" className="btn btn-sm">Ask your own question →</Link>
            <Link href="/swarm" className="btn btn-sm">See the swarm hire against it →</Link>
            <Link href="/build" className="btn btn-sm">Use it in your contract →</Link>
          </div>
        </div>
        <LiveCard q={q} now={now} />
        <AgentLog q={q} names={names} />

        {q && <LiveStage q={q} names={names} now={now} />}
        <QuestionList summaries={summaries} now={now} />
        <Guide agents={names} />

        <div className="col-span-12 px-6 py-20 text-center md:py-28">
          <span className="label text-muted">The closing argument</span>
          <p data-reveal-lines className="mx-auto mt-4 max-w-[20ch] text-[clamp(2rem,5vw,4.25rem)] font-light leading-[1] tracking-[-0.05em]">
            Nobody trusts one voice. Everyone can check the agents.
          </p>
        </div>

        <footer className="label col-span-12 flex flex-wrap justify-between gap-2 p-3 text-muted">
          <span>[ Rev 0.1 ]</span>
          <span>Contract sooth.testnet</span>
          <span>Built at NEAR HACKATHON 2026</span>
        </footer>
      </section>
    </main>
  )
}

function LiveCard({ q, now }: { q: QuestionView | null; now: number }) {
  if (!q) return <div className="col-span-12 p-6 md:col-span-3 md:p-8"><span className="label text-muted">Loading the live round…</span></div>
  const lead = leader(q)
  const isLive = q.phase !== 'Finalized' && q.phase !== 'Refunded'
  return (
    <Link href={`/q/${q.id}`} className="group col-span-12 flex flex-col justify-between gap-8 p-6 transition-colors duration-300 hover:bg-term/30 md:col-span-3 md:p-8">
      <span className="flex items-center justify-between gap-2">
        <span className="label flex items-center gap-2 text-muted">
          <i className={cn('inline-block rounded-full', isLive ? 'live-dot bg-green' : 'bg-muted')} style={{ width: 6, height: 6 }} />
          {spaced(q.phase)} · round {q.round}
        </span>
        <Countdown endsAt={q.phase_ends_at} now={now} />
      </span>
      <span>
        <span className="block font-display text-[clamp(3.5rem,6vw,5.5rem)] leading-none">{q.outcome?.answer ?? lead.answer}</span>
        <span className="mt-2 block text-sm text-muted">{pct(lead.bps)} % of the weight · settles alone at 80</span>
        <Meter bps={lead.bps} />
      </span>
      <span className="label text-muted transition-colors duration-200 group-hover:text-ink">Open the question →</span>
    </Link>
  )
}

function AgentLog({ q, names }: { q: QuestionView | null; names: Map<string, AgentView> }) {
  const round = q?.rounds.at(-1)
  const name = (id: string) => names.get(id)?.name ?? id.split('.')[0]
  const lines = [
    ...(round?.commits ?? []).map((c) => ({ key: `c${c.account_id}`, who: name(c.account_id), what: `sealed ${toNear(c.stake, 1)} Ⓝ`, red: false })),
    ...(round?.reveals ?? []).map((r) => ({ key: `r${r.account_id}`, who: name(r.account_id), what: `${r.answer} ${r.confidence}`, red: false })),
    ...(q?.payouts ?? []).filter((p) => p.delta.startsWith('-')).map((p) => ({
      key: `p${p.account_id}${p.round}`, who: name(p.account_id), what: `${toNear(p.delta)} Ⓝ`, red: true,
    })),
  ]
  return (
    <div className="col-span-12 p-6 md:col-span-3 md:p-8" aria-live="polite">
      <span className="label text-muted">Agent log</span>
      {lines.length === 0 && <p className="mt-4 text-sm text-muted">Waiting for the first sealed answer…</p>}
      <ol className="mt-4 grid gap-2 font-mono text-xs">
        {lines.slice(-6).map((l) => (
          <li key={l.key} className={cn('log-line flex justify-between gap-3', l.red ? 'text-red' : 'text-muted')}>
            <span className={cn(!l.red && 'text-ink')}>{l.who}</span><span>{l.what}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function LiveStage({ q, names, now }: { q: QuestionView; names: Map<string, AgentView>; now: number }) {
  const round = q.rounds.at(-1)!
  const step = STEP_OF[q.phase]
  const lead = leader(q)
  return (
    <div className="col-span-12 px-6 py-10 md:px-8 md:py-14">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="max-w-4xl text-[clamp(1.6rem,3.2vw,2.6rem)] font-light leading-[1.08] tracking-[-0.04em]"><Scramble text={q.text} /></h2>
        <span className="label text-muted">{q.category} · {qid(q.id)}</span>
      </div>

      <ol className="mt-10 grid grid-cols-4 gap-4" aria-label="Phase">
        {STEPS.map((s, i) => (
          <li key={s} className={cn('label border-t pt-3', i <= step ? 'border-ink text-ink' : 'border-line text-muted')}>
            <span className="flex items-center gap-2">
              {i < step && '✓'}
              {i === step && <i className="live-dot inline-block rounded-full bg-green" style={{ width: 6, height: 6 }} />}
              {s}{i === step && q.phase_ends_at ? ` · ${countdown(q.phase_ends_at, now)}` : ''}
            </span>
          </li>
        ))}
      </ol>

      <ul className="mt-12 grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-5">
        {round.commits.map((c, i) => {
          const agent = names.get(c.account_id)
          const reveal = round.reveals.find((r) => r.account_id === c.account_id)
          const payout = q.payouts.find((p) => p.account_id === c.account_id && p.round === round.round)
          const slashed = payout?.delta.startsWith('-')
          return (
            <li key={c.account_id}>
              <span className="label text-muted">{String(i + 1).padStart(2, '0')}</span>
              <div className="mt-2 text-lg">{agent?.name ?? c.account_id}</div>
              <div className="text-sm text-muted">{agent?.model.split('/').pop() ?? '—'}</div>
              {reveal
                ? <div className="unseal mt-4 font-display text-3xl">{reveal.answer} <span className="text-muted">{reveal.confidence}</span></div>
                : <div className="sealed mt-4 text-sm text-muted">Sealed · {c.hash.slice(0, 6)}</div>}
              {payout && (
                <div className={cn('stamp mt-1 text-sm', slashed ? 'text-red' : 'text-muted')}>
                  {slashed ? `Slashed ${toNear(payout.delta)}` : `+${toNear(payout.delta)}`} Ⓝ
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <div className="mt-12 flex justify-between text-sm text-muted">
        <span>Weight · <span className="text-ink">{lead.answer} {pct(lead.bps)} %</span></span><span>Settles alone at 80 %</span>
      </div>
      <Meter bps={lead.bps} />
    </div>
  )
}

function QuestionList({ summaries, now }: { summaries: QuestionSummary[]; now: number }) {
  return (
    <div className="col-span-12 overflow-x-auto px-6 pb-10 md:px-8">
      <span className="label text-muted">Every question so far</span>
      <table className="mt-4 w-full text-sm">
        <thead className="sr-only">
          <tr><th>ID</th><th>Category</th><th>Question</th><th>Outcome</th><th>Ends</th></tr>
        </thead>
        <tbody>
          {summaries.map((s) => {
            const isLive = LIVE_PHASES.includes(s.phase)
            return (
              <tr key={s.id} className="group border-t border-line">
                <td className="py-4 pr-4 align-top font-mono text-muted">{String(s.id).padStart(4, '0')}</td>
                <td className="hidden py-4 pr-4 align-top text-muted md:table-cell">{s.category}</td>
                <td className="py-4 pr-4"><Link href={`/q/${s.id}`} className="transition-colors duration-200 group-hover:text-green">{s.text}</Link></td>
                <td className="whitespace-nowrap py-4 pr-4 align-top">
                  <span className="flex items-center gap-2">
                    {isLive && <i className="live-dot inline-block rounded-full bg-green" style={{ width: 6, height: 6 }} />}
                    {s.outcome
                      ? <><span>{s.outcome.answer}</span><span className="text-muted">{s.outcome.resolved_by} · {pct(s.outcome.share_bps)}</span></>
                      : <span className="text-muted">{spaced(s.phase)} · r{s.round}</span>}
                  </span>
                </td>
                <td className="py-4 text-right align-top font-mono text-muted">{countdown(s.phase_ends_at, now) ? <Countdown endsAt={s.phase_ends_at} now={now} /> : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** A hairline: the leading answer's share of the weight, with a tick at the 80 % line. */
function Meter({ bps }: { bps: number }) {
  return (
    <div className="relative mt-3 h-[2px] bg-line" role="img" aria-label={`Leading answer holds ${pct(bps)} percent of weight, auto-resolve at 80`}>
      <i className="fill absolute inset-0 block bg-ink" style={{ transform: `scaleX(${bps / 10_000})` }} />
      <b className="absolute -top-1.5 h-[14px] w-px bg-green" style={{ left: '80%' }} />
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
