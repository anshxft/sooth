// Live progress for one question: where it is, what the agents are doing right now, and how long
// the current step has left. Everything comes from get_question, polled by the page.
import { type AgentView, type QuestionView, countdown, isSwarmAgent, nsToMs } from './near'
import { cn } from './utils'

const STEPS = ['Asked', 'Agents research & seal', 'Answers open', 'Counted', 'Challenge window', 'Final'] as const

/** Index of the step in progress (STEPS.length when finished). */
function stepOf(phase: string): number {
  switch (phase) {
    case 'Scheduled':
    case 'Commit': return 1
    case 'Reveal': return 2
    case 'AwaitingTally': return 3
    case 'Challenge': return 4
    case 'AwaitingFinalize':
    case 'Dao': return 5
    default: return STEPS.length // Finalized, Refunded
  }
}

function nowLine(q: QuestionView, sealed: number, opened: number, agents: number): string {
  switch (q.phase) {
    case 'Scheduled': return 'Waiting for the start time. Then the agents begin researching.'
    case 'Commit': return sealed === 0
      ? 'The agents are reading the question and gathering evidence. Sealed answers usually appear within a few minutes.'
      : `${sealed} of ${agents} agents have locked a stake behind a sealed answer. Nobody can see the answers yet.`
    case 'Reveal': return `Answers are opening: ${opened} of ${sealed} revealed, each with its evidence.`
    case 'AwaitingTally': return 'All answers are in. The next agent pass counts the weighted vote.'
    case 'Challenge': return 'The vote is counted. Anyone can still challenge it with a bond before it becomes final.'
    case 'AwaitingFinalize': return 'Settling: paying the agents that were right out of the stakes of the ones that were wrong.'
    case 'Dao': return 'The agents could not agree after two rounds, so the DAO decides.'
    case 'Refunded': return 'No agent revealed, so the fee went back to the asker.'
    default: return 'Done. The answer is on chain, and other contracts can read it.'
  }
}

/** Share of the current phase's window already used, 0..1 (null when the phase has no deadline). */
function windowUsed(q: QuestionView, now: number): number | null {
  const r = q.rounds.at(-1)
  if (!r) return null
  const span: [string, string] | null =
    q.phase === 'Commit' ? [r.commit_start, r.commit_end]
    : q.phase === 'Reveal' ? [r.commit_end, r.reveal_end]
    : q.phase === 'Challenge' && q.challenge_end && r.tally ? [r.tally.tallied_at, q.challenge_end]
    : null
  if (!span) return null
  const [start, end] = span.map(nsToMs)
  return end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : null
}

type Props = { q: QuestionView; names: Map<string, AgentView>; now: number }

export function QuestionProgress({ q, names, now }: Props) {
  const round = q.rounds.at(-1)
  const step = stepOf(q.phase)
  const isDone = step >= STEPS.length
  const agents = [...names.values()].filter((a) => isSwarmAgent(a.account_id))
  const sealed = round?.commits.length ?? 0
  const opened = round?.reveals.length ?? 0
  const used = windowUsed(q, now)
  const end = q.phase === 'Commit' ? round?.commit_end : q.phase === 'Reveal' ? round?.reveal_end : q.phase === 'Challenge' ? q.challenge_end : null
  const left = countdown(end, now)

  return (
    <div className="col-span-12 p-4" aria-labelledby="progress-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="progress-title" className="label text-muted">{isDone ? 'How it was settled' : `Live progress${q.round > 1 ? ` · round ${q.round}` : ''}`}</h2>
        {left && <span className="label font-mono">{left} left in this step</span>}
      </div>

      <ol className="mt-3 grid grid-cols-3 gap-1 sm:grid-cols-6">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? 'step' : undefined}
            className={cn(
              'label border px-2 py-2 transition-colors duration-300',
              i < step && 'border-ink bg-ink text-canvas',
              i === step && 'live-dot border-ink bg-green text-ink',
              i > step && 'border-line text-muted',
            )}
          >
            {i < step ? '✓ ' : ''}{s}
          </li>
        ))}
      </ol>

      {used !== null && (
        <div className="mt-2 h-1 w-full overflow-hidden bg-line" aria-hidden="true">
          <div className="h-1 w-full origin-left bg-ink transition-transform duration-1000 ease-linear" style={{ transform: `scaleX(${used})` }} />
        </div>
      )}

      <p className="mt-3 max-w-3xl" role="status" aria-live="polite">{nowLine(q, sealed, opened, agents.length)}</p>

      {round && agents.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="What each agent is doing">
          {agents.map((a) => {
            const reveal = round.reveals.find((r) => r.account_id === a.account_id)
            const hasCommitted = round.commits.some((c) => c.account_id === a.account_id)
            const isResearching = !hasCommitted && q.phase === 'Commit'
            const label = reveal ? `${reveal.answer} ${reveal.confidence}` : hasCommitted ? '🔒 sealed' : isResearching ? 'researching…' : 'sat out'
            return (
              <li key={a.account_id} className={cn('label flex items-center gap-2 border px-2 py-1', reveal ? 'border-ink' : 'border-line')}>
                <span className="font-semibold normal-case">{a.name}</span>
                <span key={label} className={cn(reveal ? 'unseal' : hasCommitted || isResearching ? 'sealed' : '', !reveal && 'text-muted')}>{label}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
