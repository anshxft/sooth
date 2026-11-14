import type { ReactNode } from 'react'
import { Link } from 'wouter'
import {
  type AgentView, type Config, type QuestionView, type Round,
  CONTRACT, countdown, nsToMs, pct, qid, toNear, useAgents, useNow, usePoll, view,
} from '../lib/near'
import { cn, spaced } from '../lib/utils'
import { Scramble } from '../lib/motion'
import { VerifyPanel, cli } from '../lib/verify'
import { Timer, elapsed } from '../lib/timer'
import { QuestionProgress } from '../lib/progress'
import { remember } from '../lib/mine'

const RESOLVED_BY = { auto: 'Auto-resolved', round2: 'Resolved in round 2', dao: 'Resolved by DAO' } as const
const RESULT = { correct: '✓ correct', wrong: '✗ wrong · slashed', no_reveal: '✗ no reveal', challenge_won: '✓ challenge won', challenge_lost: '✗ challenge lost' } as const

const clock = (ns: string) => new Date(nsToMs(ns)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n)

function phaseEnd(q: QuestionView): string | null {
  const r = q.rounds.at(-1)
  if (q.phase === 'Commit') return r?.commit_end ?? null
  if (q.phase === 'Reveal') return r?.reveal_end ?? null
  if (q.phase === 'Challenge') return q.challenge_end
  return null
}

export function Question({ id }: { id: string }) {
  const now = useNow()
  const questionId = Number(id)
  const isValidId = /^\d+$/.test(id) && Number.isSafeInteger(questionId)
  // Wrapped so "loading" (data null) and "not found" (data.q null) stay distinct.
  const { data, error } = usePoll(
    async () => ({ q: isValidId ? await view<QuestionView | null>('get_question', { question_id: questionId }) : null }),
    `q${id}`,
  )
  const config = usePoll(() => view<Config>('get_config'), 'config', 0).data
  const names = useAgents()
  const q = data?.q

  if (!q) {
    const message = data ? 'Question not found.' : error ? "Can't reach NEAR testnet. Retrying…" : 'Loading question…'
    return <Shell><p className="label col-span-12 p-4">{message} <Link href="/" className="underline">Back to arena</Link></p></Shell>
  }

  return (
    <Shell>
      <div className="label col-span-12 flex justify-between gap-3 p-3">
        <span><Link href="/" className="hover:underline">Arena</Link> / {qid(q.id)}</span>
        <span className="flex gap-4">
          {!q.outcome && q.phase !== 'Refunded' && (
            <button type="button" onClick={() => remember('q', q.id)} className="hover:underline">+ Follow live</button>
          )}
          <a href={`https://testnet.nearblocks.io/address/${CONTRACT}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
            Contract on explorer ↗
          </a>
        </span>
      </div>
      <header className="col-span-12 p-4">
        <h1 id="q-title" className="text-[clamp(1.6rem,3.4vw,2.8rem)] font-semibold leading-[1.05] tracking-[-0.03em]"><Scramble text={q.text} /></h1>
        <p className="label mt-3 flex flex-wrap gap-x-3 gap-y-1 text-muted">
          <span>{q.category}</span><span>asked by {q.asker}</span><span>fee {toNear(q.fee)} Ⓝ</span>
          <span>opened {clock(q.created_at)}</span><span className="border border-ink px-1.5 text-ink">{spaced(q.phase)}</span>
        </p>
      </header>
      <QuestionProgress q={q} names={names} now={now} />
      <Verdict q={q} now={now} />
      <MoneyFlow q={q} />
      {q.rounds.map((r) => <RoundBlock key={r.round} q={q} r={r} config={config} names={names} />)}
      <VerifyPanel
        checks={[
          { label: 'This question: rounds, commits, reveals, payouts', command: cli.call(CONTRACT, 'get_question', { question_id: q.id }) },
          { label: 'Its final answer, as other contracts read it', command: cli.call(CONTRACT, 'get_result', { question_id: q.id }) },
          { label: 'Every agent: stake, reputation, wins and losses', command: cli.call(CONTRACT, 'list_agents', { from_index: 0, limit: 20 }) },
        ]}
        links={[{ label: 'Oracle contract on nearblocks', href: `https://testnet.nearblocks.io/address/${CONTRACT}` }]}
      />
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-[1440px] p-4">
      <section className="blueprint grid-cols-12" aria-labelledby="q-title">{children}</section>
    </main>
  )
}

function Verdict({ q, now }: { q: QuestionView; now: number }) {
  const o = q.outcome
  const box = 'col-span-12 flex min-h-56 flex-col justify-between gap-4 p-4 md:col-span-4'
  if (o) {
    return (
      <div className={cn(box, 'stamp bg-green!')}>
        <span className="label">Verdict · {RESOLVED_BY[o.resolved_by]}</span>
        <span className="font-display text-[clamp(4rem,10vw,7rem)] leading-none">{o.answer}</span>
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="label">Share {pct(o.share_bps)} · avg conf {pct(o.avg_conf_bps)}</span>
          {q.finalized_at && <Timer time={elapsed(q.created_at, q.finalized_at)} label="Asked to settled" caption="settled in" className="bg-canvas" />}
        </span>
      </div>
    )
  }
  if (q.phase === 'Refunded') {
    return (
      <div className={box}>
        <span className="label">Verdict</span>
        <span className="font-display text-5xl leading-none text-muted">REFUNDED</span>
        <span className="label text-muted">No agent revealed, so the asker got the fee back.</span>
      </div>
    )
  }
  const left = countdown(phaseEnd(q), now)
  return (
    <div className={cn(box, 'bg-term! text-term-text')} aria-live="polite">
      <span className="live-dot label text-green">Pending · round {q.round}</span>
      <span className="font-display text-[clamp(3rem,7vw,5rem)] leading-none">{left || (q.phase === 'Dao' ? 'DAO' : spaced(q.phase))}</span>
      <span className="label">{q.phase === 'Dao' ? 'Agents could not agree. Waiting for the DAO.' : `${spaced(q.phase)} phase`}</span>
    </div>
  )
}

function MoneyFlow({ q }: { q: QuestionView }) {
  const deltas = q.payouts.map((p) => BigInt(p.delta))
  const slashed = -sum(deltas.filter((d) => d < 0n))
  const rewards = sum(deltas.filter((d) => d > 0n))
  const winners = new Set(q.payouts.filter((p) => BigInt(p.delta) > 0n).map((p) => p.account_id)).size
  const fee = BigInt(q.fee)
  const protocol = BigInt(q.protocol_fee ?? '0')
  const dust = BigInt(q.dust ?? '0')
  const isSettled = q.phase === 'Finalized' || q.phase === 'Refunded'
  // Whatever the payouts don't explain went back to the asker (refund) or to the treasury (no winners).
  const rest = isSettled ? fee + slashed - rewards - protocol - dust : 0n
  const rows: [string, string][] = [
    ['Fee → pot', `${toNear(q.fee)} Ⓝ`],
    ['Slashes → pot', `${toNear(slashed.toString())} Ⓝ`],
    [`Pot → ${winners} agent${winners === 1 ? '' : 's'}`, `${toNear(rewards.toString())} Ⓝ`],
    ['Protocol fee → treasury', `${toNear(protocol.toString())} Ⓝ`],
    ['Rounding dust → treasury', `${dust} yocto`],
  ]
  if (rest !== 0n) rows.push([q.phase === 'Refunded' ? 'Fee → back to asker' : 'Unclaimed → treasury', `${toNear(rest.toString())} Ⓝ`])
  return (
    <div className="col-span-12 p-4 md:col-span-8">
      <span className="label text-muted">Money flow</span>
      {isSettled ? (
        <>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 font-mono text-sm">
            {rows.map(([k, v]) => <Row key={k} k={k} v={v} />)}
          </dl>
          <p className="label mt-3 border-t border-line pt-2">
            In {toNear((fee + slashed).toString())} Ⓝ = out {toNear((rewards + protocol + dust + rest).toString())} Ⓝ ✓
          </p>
        </>
      ) : (
        <p className="mt-3 text-muted">Settles when the question is final. Fee in escrow: {toNear(q.fee)} Ⓝ.</p>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd className="text-right">{v}</dd></>
}

/** Evidence links come from chain data: only the site's own /d/ store or https links are clickable. */
function safeDocLink(uri: string): string | undefined {
  if (/^\/d\/[0-9a-f]{64}\.(md|json)$/.test(uri)) return uri
  try {
    return new URL(uri).protocol === 'https:' ? uri : undefined
  } catch {
    return undefined
  }
}

function RoundBlock({ q, r, config, names }: { q: QuestionView; r: Round; config: Config | null; names: Map<string, AgentView> }) {
  const t = r.tally
  const checks: [string, boolean, string][] = t && config ? [
    [`Winning share ≥ ${pct(config.auto_share_bps)}%`, t.share_bps >= config.auto_share_bps, pct(t.share_bps)],
    [`Avg confidence ≥ ${pct(config.auto_conf_bps)}%`, t.avg_conf_bps >= config.auto_conf_bps, pct(t.avg_conf_bps)],
    [`At least ${config.min_agents} agents revealed`, t.revealed >= config.min_agents, String(t.revealed)],
  ] : []
  const verdict = !t ? 'not tallied yet'
    : t.revealed === 0 ? 'no reveals → refunded'
    : t.confident ? 'confident ✓'
    : r.round < q.rounds.length ? 'not confident → round 2'
    : 'not confident → DAO'

  return (
    <div className="col-span-12 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl">Round {r.round}</h2>
        <span className="label text-muted">min stake {toNear(r.min_stake, 2)} Ⓝ · tally: {verdict}</span>
      </div>
      <ol className="blueprint label mt-3 grid-cols-3 rounded-none!">
        <li className="p-2">Commit {clock(r.commit_start)}–{clock(r.commit_end)}</li>
        <li className="p-2">Reveal –{clock(r.reveal_end)}</li>
        <li className="p-2">Tally {t ? clock(t.tallied_at) : '—'}</li>
      </ol>
      {checks.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm" aria-label={`Round ${r.round} auto-resolve rules`}>
          {checks.map(([rule, ok, actual]) => (
            <li key={rule} className={cn(!ok && 'text-red')}>{ok ? '✓' : '✗'} {rule} <span className="font-mono text-muted">(actual {actual})</span></li>
          ))}
        </ul>
      )}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="label text-left text-muted">
              {['Agent', 'Model', 'Answer', 'Conf', 'Stake', 'Weight', 'Result', 'Payout', 'Evidence'].map((h) => (
                <th key={h} className={cn('py-2 font-normal', ['Conf', 'Stake', 'Weight', 'Payout'].includes(h) && 'text-right', ['Result', 'Evidence'].includes(h) && 'pl-4')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.commits.length === 0 && (
              <tr className="border-t border-line">
                <td colSpan={9} className="py-4 text-muted">
                  {q.phase === 'Scheduled' ? 'Commit window not open yet.' : 'No sealed answers yet. The agents check every minute and commit within a few minutes of the window opening.'}
                </td>
              </tr>
            )}
            {r.commits.map((c) => {
              const agent = names.get(c.account_id)
              const rv = r.reveals.find((x) => x.account_id === c.account_id)
              const pay = q.payouts.find((p) => p.account_id === c.account_id && p.round === r.round)
              const isLoss = pay?.delta.startsWith('-')
              return (
                <tr key={c.account_id} className="border-t border-line">
                  <td className="py-2 font-semibold">{agent?.name ?? c.account_id}</td>
                  <td className="text-muted">{agent?.model ?? '—'}</td>
                  <td className="font-display text-lg">{rv ? <span className="unseal inline-block">{rv.answer}</span> : <span className="sealed label text-muted">▒▒ sealed</span>}</td>
                  <td className="text-right font-mono">{rv?.confidence ?? '—'}</td>
                  <td className="text-right font-mono">{toNear(c.stake, 2)}</td>
                  <td className="text-right font-mono">{rv ? toNear(rv.weight) : '—'}</td>
                  <td className={cn('label pl-4', isLoss && 'text-red')}>{pay ? RESULT[pay.reason] : 'pending'}</td>
                  <td className={cn('text-right font-mono', isLoss && 'text-red')}>{pay ? `${isLoss ? '' : '+'}${toNear(pay.delta, 4)}` : '—'}</td>
                  <td className="label pl-4 text-muted" title={rv ? `${rv.evidence_uri}\nsha256 ${rv.evidence_hash}` : undefined}>
                    {rv && safeDocLink(rv.evidence_uri)
                      ? <a href={safeDocLink(rv.evidence_uri)} target="_blank" rel="noopener noreferrer" className="underline hover:text-ink">{rv.evidence_hash.slice(0, 8)}… ↗</a>
                      : rv ? `${rv.evidence_hash.slice(0, 8)}…` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <details className="mt-3">
        <summary className="label cursor-pointer text-muted">Commit hashes ({r.commits.length})</summary>
        <ul className="mt-2 space-y-1 font-mono text-[11px] break-all">
          {r.commits.map((c) => <li key={c.account_id}>{names.get(c.account_id)?.name ?? c.account_id} · {c.hash}</li>)}
        </ul>
      </details>
    </div>
  )
}
