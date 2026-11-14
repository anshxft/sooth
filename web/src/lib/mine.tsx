// "Your requests": questions and tasks this browser sent, followed live from any page, so the person
// who asked can see their work moving. Kept in localStorage only; nothing leaves the browser.
import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { type QuestionView, countdown, qid, useNow, usePoll, view } from './near'
import { type Job, type Task, swarmView } from './swarm'
import { cn, spaced } from './utils'

type Mine = { kind: 'q' | 't'; id: number }
const KEY = 'sooth-mine'
const MAX = 5
const POLL_MS = 15_000
const CHANGED = 'sooth-mine-changed'

function read(): Mine[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((m) => (m?.kind === 'q' || m?.kind === 't') && Number.isSafeInteger(m?.id)).slice(0, MAX) : []
  } catch {
    return []
  }
}

function write(list: Mine[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {
    // private mode or storage blocked: the tracker just stays empty
  }
  window.dispatchEvent(new Event(CHANGED))
}

/** Called by the Ask and Hire pages after a successful transaction. */
export function remember(kind: Mine['kind'], id: number) {
  write([{ kind, id }, ...read().filter((m) => !(m.kind === kind && m.id === id))])
}

const forget = (m: Mine) => write(read().filter((x) => !(x.kind === m.kind && x.id === m.id)))

export function MyRequests() {
  const [list, setList] = useState<Mine[]>(read)
  const [isOpen, setIsOpen] = useState(false) // one line by default, so it never hides the page
  useEffect(() => {
    const sync = () => setList(read())
    window.addEventListener(CHANGED, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANGED, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  if (list.length === 0) return null

  return (
    <aside aria-label="Following live" className="glass fixed bottom-24 left-4 z-40 w-[min(18rem,calc(100vw-2rem))] border border-ink shadow-[0_8px_30px_rgb(0_0_0/0.12)]">
      <button type="button" onClick={() => setIsOpen((o) => !o)} aria-expanded={isOpen} aria-controls="following-more"
        className="label flex w-full items-center justify-between gap-2 px-3 py-2 transition-colors duration-150 hover:bg-ink hover:text-canvas">
        <span className="live-dot">Following ({list.length})</span>
        <span aria-hidden="true">{isOpen ? '–' : list.length > 1 ? `+${list.length - 1}` : '+'}</span>
      </button>
      {/* The newest stays in view; the rest open in place, so the card grows from where it sits. */}
      <ul className="border-t border-line">{list.slice(0, 1).map((m) => <Row key={`${m.kind}${m.id}`} m={m} isCompact={!isOpen} />)}</ul>
      {list.length > 1 && (
        <div id="following-more" className="expand" data-open={isOpen} inert={!isOpen}>
          <ul className="min-h-0 overflow-hidden">{list.slice(1).map((m) => <Row key={`${m.kind}${m.id}`} m={m} isCompact={false} />)}</ul>
        </div>
      )}
    </aside>
  )
}

function Row({ m, isCompact }: { m: Mine; isCompact: boolean }) {
  return (
    <li className="flex items-start gap-2 border-t border-line px-3 py-2 first:border-t-0">
      {m.kind === 'q' ? <QuestionRow id={m.id} isCompact={isCompact} /> : <TaskRow id={m.id} />}
      <button type="button" onClick={() => forget(m)} aria-label="Stop following" className="label text-muted hover:text-ink">×</button>
    </li>
  )
}

function QuestionRow({ id, isCompact }: { id: number; isCompact: boolean }) {
  const now = useNow()
  const q = usePoll(() => view<QuestionView | null>('get_question', { question_id: id }), `mine-q${id}`, POLL_MS).data
  const r = q?.rounds.at(-1)
  const end = q?.phase === 'Commit' ? r?.commit_end : q?.phase === 'Reveal' ? r?.reveal_end : q?.phase === 'Challenge' ? q.challenge_end : null
  const left = countdown(end, now)
  const status = !q ? 'loading…'
    : q.outcome ? `✓ ${q.outcome.answer}`
    : q.phase === 'Refunded' ? 'refunded'
    : q.phase === 'Commit' ? `${r?.commits.length ?? 0} agents sealed`
    : q.phase === 'Reveal' ? `${r?.reveals.length ?? 0}/${r?.commits.length ?? 0} answers open`
    : spaced(q.phase)
  return (
    <Link href={`/q/${id}`} className="min-w-0 flex-1 hover:underline">
      <span className="label block">{qid(id)} · <span className={cn(!q?.outcome && 'text-muted')}>{status}</span>{left && ` · ${left}`}</span>
      {q && !isCompact && <span className="block truncate text-sm">{q.text}</span>}
    </Link>
  )
}

function TaskRow({ id }: { id: number }) {
  const data = usePoll(async () => ({
    t: await swarmView<Task | null>('get_task', { task_id: id }),
    jobs: await swarmView<Job[]>('list_jobs', { task_id: id, limit: 10 }),
  }), `mine-t${id}`, POLL_MS).data
  const live = data?.jobs.find((j) => j.phase !== 'Closed')
  const done = data?.jobs.filter((j) => j.result === 'accepted' || j.result === 'claimed' || j.result === 'won_dispute').length ?? 0
  const status = !data ? 'loading…'
    : !data.t ? 'not found'
    : live ? `job ${live.id}: ${spaced(live.phase).toLowerCase()}`
    : data.jobs.length === 0 ? 'contractor is planning jobs'
    : `${done} job${done === 1 ? '' : 's'} delivered`
  return (
    <Link href={`/t/${id}`} className="min-w-0 flex-1 hover:underline">
      <span className="label block">T-{String(id).padStart(3, '0')} · <span className="text-muted">{status}</span></span>
    </Link>
  )
}
