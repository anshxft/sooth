// "Agents online" badge: whether the GitHub Actions run that drives the agents is live right now.
// Public API, no token; GitHub allows 60 requests an hour per visitor, so it is polled every 5 minutes.
import { usePoll } from './near'
import { cn } from './utils'

const RUNS = 'https://api.github.com/repos/anshxft/sooth/actions/workflows/agents.yml/runs?per_page=5'
const POLL_MS = 5 * 60_000
const ACTIONS = 'https://github.com/anshxft/sooth/actions/workflows/agents.yml'

type Run = { status: string; updated_at: string }
type State = 'online' | 'starting' | 'offline'
// A run waiting behind the live one in the concurrency group reports "pending", so the newest run
// alone does not tell: look at the last few.
const WAITING = new Set(['queued', 'pending', 'waiting', 'requested'])

async function agentsState(): Promise<State | null> {
  const res = await fetch(RUNS, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`GitHub ${res.status}`)
  const runs: Run[] = (await res.json()).workflow_runs ?? []
  if (runs.length === 0) return null
  return runs.some((r) => r.status === 'in_progress') ? 'online' : runs.some((r) => WAITING.has(r.status)) ? 'starting' : 'offline'
}

export function AgentsStatus() {
  const { data: state, error } = usePoll(agentsState, 'agents-run', POLL_MS)
  if (error || !state) return null // rate-limited, loading or unknown: say nothing rather than guess
  const text = { online: 'Agents online', starting: 'Agents starting', offline: 'Agents offline' }[state]
  return (
    <a
      href={ACTIONS}
      target="_blank"
      rel="noopener noreferrer"
      title="The jury and the swarm run on GitHub Actions, one pass a minute"
      className={cn('label hidden items-center gap-1.5 hover:underline sm:flex', state === 'offline' ? 'text-red' : 'text-muted')}
    >
      <span aria-hidden="true" style={{ width: 8, height: 8 }} className={cn('rounded-full', state === 'online' ? 'bg-green' : state === 'offline' ? 'bg-red' : 'bg-line')} />
      {text}
    </a>
  )
}
