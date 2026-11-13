import { Fragment, type ReactNode, useState } from 'react'
import { Link } from 'wouter'
import { connector, countdown, toNear, useAccount, useNow, usePoll } from '../lib/near'
import { type Job, type Task, type Worker, SWARM, jobPhaseEnd, paidOut, swarmView, useDoc } from '../lib/swarm'
import { cn, spaced } from '../lib/utils'
import { Scramble } from '../lib/motion'
import { Bills } from '../lib/bills'
import { VerifyPanel, cli } from '../lib/verify'
import { Timer, elapsed } from '../lib/timer'

const POLL_MS = 5_000
const STEPS = ['Sealed bids', 'Reveal', 'Deliver', 'Review', 'Settled'] as const
const STEP_OF: Record<Job['phase'], number> = {
  BidCommit: 0, BidReveal: 1, AwaitingAward: 1, Delivering: 2, DeliveryMissed: 2, Review: 3, Claimable: 3, Disputed: 3, Closed: 4,
}
const RESULT: Record<NonNullable<Job['result']>, { text: string; isBad: boolean }> = {
  accepted: { text: 'Accepted · paid', isBad: false },
  claimed: { text: 'Claimed after review window · paid', isBad: false },
  won_dispute: { text: 'Jury: work is good · paid', isBad: false },
  lost_dispute: { text: 'Jury: work rejected · refunded, bond slashed', isBad: true },
  split: { text: 'Jury: unclear · split 50/50', isBad: false },
  missed_delivery: { text: 'Missed delivery · bond slashed', isBad: true },
  no_bids: { text: 'No valid bids', isBad: true },
}

const short = (id: string) => id.split('.')[0]
const TITLE_MAX = 90
/** First line of a document, cut to its first sentence and to a word boundary. */
function title(markdown: string): string {
  const line = markdown.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '') ?? ''
  const sentence = line.split(/(?<=[.!?])\s/)[0]
  return sentence.length <= TITLE_MAX ? sentence : `${sentence.slice(0, TITLE_MAX).replace(/\s+\S*$/, '')}…`
}

export function Swarm() {
  const tasks = usePoll(() => swarmView<Task[]>('list_tasks', { limit: 20 }), 'tasks', POLL_MS)
  const jobs = usePoll(() => swarmView<Job[]>('list_jobs', { limit: 50 }), 'jobs', POLL_MS)
  const workers = usePoll(() => swarmView<Worker[]>('list_workers', { limit: 20 }), 'workers', POLL_MS)
  const all = jobs.data ?? []
  const paid = all.reduce((s, j) => s + paidOut(j), 0n)
  const slashed = (workers.data ?? []).reduce((s, w) => s + BigInt(w.stats.slashed), 0n)
  const [open, setOpen] = useState<string | null>(null)

  return (
    <>
      <Shell label="swarm-title" error={tasks.error ?? jobs.error}>
      <div className="col-span-12 flex flex-wrap items-end justify-between gap-4 p-4">
        <div>
          <h1 id="swarm-title" className="font-display text-[clamp(3rem,9vw,7rem)] leading-[0.9] tracking-[-0.04em]"><Scramble text="swarm" /></h1>
          <p className="mt-2 max-w-xl text-muted">
            A contractor agent spends a capped budget on sealed-bid jobs. When it rejects the work, the SOOTH jury rules and the contract pays out.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/hire" className="label bg-green px-2 py-1 text-ink hover:bg-ink hover:text-canvas">Hire the swarm →</Link>
          <a href={`https://testnet.nearblocks.io/address/${SWARM}`} target="_blank" rel="noopener noreferrer" className="label hover:underline">
            {SWARM} ↗
          </a>
        </div>
      </div>
      <Stat label="Tasks" value={String(tasks.data?.length ?? '—')} />
      <Stat label="Jobs" value={jobs.data ? String(all.length) : '—'} />
      <Stat label="Paid to workers" value={jobs.data ? toNear(paid.toString()) : '—'} unit="Ⓝ" />
      <Stat label="Bonds slashed" value={workers.data ? toNear(slashed.toString()) : '—'} unit="Ⓝ" isRed={slashed > 0n} />

      <div className="col-span-12 p-4 md:col-span-7">
        <span className="label text-muted">Tasks</span>
        {!tasks.data && <p className="label mt-3 text-muted">Loading tasks…</p>}
        {tasks.data?.length === 0 && <p className="mt-3 text-muted">No tasks yet.</p>}
        <ul className="mt-2">
          {tasks.data?.map((t) => <TaskRow key={t.id} task={t} jobs={all.filter((j) => j.task_id === t.id)} />)}
        </ul>
      </div>
      <div className="col-span-12 p-4 md:col-span-5">
        <span className="label text-muted">Workers · open one to see its jobs</span>
        {!workers.data && <p className="label mt-3 text-muted">Loading workers…</p>}
        <ul className="mt-2 grid gap-2">
          {workers.data?.map((w) => (
            <WorkerCard
              key={w.account_id} worker={w} jobs={all} tasks={tasks.data ?? []}
              isOpen={open === w.account_id} onToggle={() => setOpen((o) => (o === w.account_id ? null : w.account_id))}
            />
          ))}
        </ul>
      </div>
      </Shell>
      {/* Notes raining over the whole page while it is open: escrow paying out. Outside the grid,
          whose animated cells would otherwise pin a fixed element to themselves. */}
      <Bills count={16} scale={0.55} className="pointer-events-none fixed inset-0 z-30 h-full w-full" />
    </>
  )
}

type WorkerCardProps = { worker: Worker; jobs: Job[]; tasks: Task[]; isOpen: boolean; onToggle: () => void }

function WorkerCard({ worker: w, jobs, tasks, isOpen, onToggle }: WorkerCardProps) {
  const net = BigInt(w.stats.earned) - BigInt(w.stats.slashed)
  const bids = jobs.filter((j) => j.bids.some((b) => b.account_id === w.account_id)).sort((a, b) => b.id - a.id)
  const bannedFrom = tasks.filter((t) => t.banned.includes(w.account_id))
  const panelId = `worker-${w.name}`
  return (
    <li className={cn('border border-ink transition-colors duration-200', isOpen ? 'bg-canvas' : 'bg-canvas hover:bg-ink/5', net < 0n && 'border-red')}>
      <button type="button" onClick={onToggle} aria-expanded={isOpen} aria-controls={panelId} className="flex w-full items-center gap-3 p-3 text-left">
        <span className="font-display text-xl">{w.name}</span>
        <span className="label text-muted">{(w.rep_bps / 10_000).toFixed(2)}× rep</span>
        <span className={cn('ml-auto font-mono text-sm font-semibold', net < 0n && 'text-red')}>{net > 0n ? '+' : ''}{toNear(net.toString())} Ⓝ</span>
        <span aria-hidden="true" className={cn('font-mono transition-transform duration-200', isOpen && 'rotate-45')}>+</span>
      </button>
      <div id={panelId} className="expand" data-open={isOpen} inert={!isOpen}>
        <div className="overflow-hidden">
          <div className="border-t border-line p-3">
            <p className="label text-muted">{w.account_id}</p>
            <dl className="mt-2 grid grid-cols-3 gap-2 font-mono text-sm">
              <Fact label="Locked" value={toNear(w.locked_balance, 2)} />
              <Fact label="Won" value={`${w.stats.successful}✓ ${w.stats.failed}✗`} />
              <Fact label="No reveal" value={String(w.stats.no_reveal)} />
              <Fact label="Earned" value={toNear(w.stats.earned)} />
              <Fact label="Slashed" value={toNear(w.stats.slashed)} isRed={w.stats.slashed !== '0'} />
              <Fact label="Free" value={toNear(w.free_balance, 2)} />
            </dl>
            {bannedFrom.length > 0 && <p className="label mt-3 text-red">Banned from {bannedFrom.map((t) => `T-${String(t.id).padStart(3, '0')}`).join(', ')} after a failed job</p>}
            <span className="label mt-3 block text-muted">Bids</span>
            {bids.length === 0 && <p className="mt-1 text-sm text-muted">No bids yet.</p>}
            <ul className="mt-1 text-sm">
              {bids.map((j) => <BidLine key={j.id} job={j} account={w.account_id} />)}
            </ul>
          </div>
        </div>
      </div>
    </li>
  )
}

function BidLine({ job: j, account }: { job: Job; account: string }) {
  const bid = j.bids.find((b) => b.account_id === account)
  const isWinner = j.winner === account
  const status = j.result ? RESULT[j.result].text : spaced(j.phase)
  const outcome = !isWinner && j.winner ? `lost to ${short(j.winner)}` : status
  const isBad = isWinner && j.result !== null && RESULT[j.result].isBad
  return (
    <li className="flex flex-wrap justify-between gap-x-3 border-t border-line py-1.5">
      <Link href={`/t/${j.task_id}`} className="hover:underline">{isWinner ? '★ ' : ''}Job {j.id}</Link>
      {bid?.price && <span className="font-mono">{toNear(bid.price, 2)} Ⓝ</span>}
      {!bid?.price && (STEP_OF[j.phase] < 2 ? <span className="sealed font-mono">sealed</span> : <span className="label text-red">✗ no reveal · bond slashed</span>)}
      <span className={cn('label w-full', isBad ? 'text-red' : 'text-muted')}>{outcome}</span>
    </li>
  )
}

function Fact({ label, value, isRed = false }: { label: string; value: string; isRed?: boolean }) {
  return (
    <div>
      <dt className="label text-muted">{label}</dt>
      <dd className={cn(isRed && 'text-red')}>{value}</dd>
    </div>
  )
}

function TaskRow({ task, jobs }: { task: Task; jobs: Job[] }) {
  const brief = useDoc(task.brief_uri, task.brief_hash).data
  const live = jobs.find((j) => j.phase !== 'Closed')
  return (
    <li className="border-t border-line py-3">
      <Link href={`/t/${task.id}`} className="block hover:underline">
        <span className="font-mono text-muted">T-{String(task.id).padStart(3, '0')}</span>{' '}
        <span className="font-semibold">{brief ? title(brief.text) : 'Loading brief…'}</span>
      </Link>
      <p className="label mt-1 flex flex-wrap gap-x-3 text-muted">
        <span>budget {toNear(task.budget, 2)} Ⓝ</span><span>paid {toNear(task.paid, 2)} Ⓝ</span>
        <span>{jobs.length} job{jobs.length === 1 ? '' : 's'}</span>
        <span className={cn('border border-ink px-1.5 text-ink', live && 'live-dot bg-green')}>{live ? spaced(live.phase) : task.status}</span>
      </p>
    </li>
  )
}

export function TaskPage({ id }: { id: string }) {
  const taskId = Number(id)
  const isValidId = /^\d+$/.test(id) && Number.isSafeInteger(taskId)
  const task = usePoll(async () => ({ t: isValidId ? await swarmView<Task | null>('get_task', { task_id: taskId }) : null }), `task${id}`, POLL_MS)
  const jobs = usePoll(() => (isValidId ? swarmView<Job[]>('list_jobs', { limit: 50, task_id: taskId }) : Promise.resolve([])), `tjobs${id}`, POLL_MS)
  const t = task.data?.t
  const brief = useDoc(t?.brief_uri ?? null, t?.brief_hash ?? null)

  if (!t) {
    const message = task.data ? 'Task not found.' : task.error ? "Can't reach NEAR testnet. Retrying…" : 'Loading task…'
    return <Shell label="task-title"><p className="label col-span-12 p-4">{message} <Link href="/swarm" className="underline">Back to swarm</Link></p></Shell>
  }
  const ordered = [...(jobs.data ?? [])].sort((a, b) => a.id - b.id)

  return (
    <Shell label="task-title" error={task.error}>
      <div className="label col-span-12 p-3"><Link href="/swarm" className="hover:underline">Swarm</Link> / T-{String(t.id).padStart(3, '0')}</div>
      <header className="col-span-12 p-4 md:col-span-8">
        <span className="label text-muted">Client brief · {t.owner}</span>
        <h1 id="task-title" className="mt-2 text-[clamp(1.4rem,3vw,2.4rem)] font-semibold leading-[1.1] tracking-[-0.03em]">
          <Scramble text={brief.data ? title(brief.data.text) : 'Loading brief…'} />
        </h1>
        {brief.data && <DocBody text={brief.data.text} isVerified={brief.data.isVerified} />}
      </header>
      <Budget task={t} />
      <CloseTask task={t} />
      {ordered.length === 0 && <p className="col-span-12 p-4 text-muted">The contractor is planning the jobs…</p>}
      {ordered.map((j) => <JobBlock key={j.id} job={j} task={t} />)}
      <VerifyPanel
        checks={[
          { label: 'This task: budget, spending, bans', command: cli.call(SWARM, 'get_task', { task_id: t.id }) },
          { label: 'Its jobs: sealed bids, reveals, deliveries, receipts', command: cli.call(SWARM, 'list_jobs', { task_id: t.id, limit: 50 }) },
          { label: 'The workers: bonds, reputation, earnings, slashes', command: cli.call(SWARM, 'list_workers', { limit: 20 }) },
        ]}
        links={[
          { label: 'Swarm contract on nearblocks', href: `https://testnet.nearblocks.io/address/${SWARM}` },
          { label: 'Contractor account', href: `https://testnet.nearblocks.io/address/${t.contractor}` },
        ]}
      />
    </Shell>
  )
}

function Budget({ task: t }: { task: Task }) {
  const budget = BigInt(t.budget)
  const parts: [string, string, string][] = [
    ['Paid to workers', t.paid, 'bg-ink'],
    ['Held for open jobs', t.reserved, 'hatch'],
    ['Jury fees + storage', t.costs, 'bg-muted'],
    ['Left', t.available, 'bg-green'],
  ]
  return (
    <div className="col-span-12 p-4 md:col-span-4">
      <span className="label text-muted">Budget · spent only by {short(t.contractor)}'s limited key</span>
      <div className="font-display mt-1 text-4xl">{toNear(t.budget, 2)} <span className="font-sans text-base">Ⓝ</span></div>
      <div className="wipe mt-3 flex h-3 border border-ink" role="img" aria-label="Budget split">
        {parts.map(([label, v, cls]) => budget > 0n && <i key={label} className={cn('block h-full', cls)} style={{ width: `${Number((BigInt(v) * 10_000n) / budget) / 100}%` }} />)}
      </div>
      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 font-mono text-sm">
        {parts.map(([label, v]) => <Fragment key={label}><dt>{label}</dt><dd className="text-right">{toNear(v)}</dd></Fragment>)}
      </dl>
      {t.banned.length > 0 && <p className="label mt-3 text-red">Banned from this task: {t.banned.map(short).join(', ')}</p>}
    </div>
  )
}

function JobBlock({ job: j, task }: { job: Job; task: Task }) {
  const now = useNow()
  const brief = useDoc(j.brief_uri, j.brief_hash)
  const step = STEP_OF[j.phase]
  const left = countdown(jobPhaseEnd(j), now)
  const result = j.result ? RESULT[j.result] : null
  return (
    <section className="col-span-12 p-4" aria-labelledby={`job-${j.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`job-${j.id}`} className="font-display text-2xl"><Scramble text={`Job ${j.id}${brief.data ? ` · ${title(brief.data.text)}` : ''}`} /></h2>
        <span className="label text-muted">max {toNear(j.max_price, 2)} Ⓝ · task {task.id}</span>
      </div>
      <ol className="blueprint mt-3 grid-cols-5 rounded-none!">
        {STEPS.map((s, i) => (
          <li key={s} className={cn('label p-2', i < step && 'bg-ink! text-canvas', i === step && (j.phase === 'Disputed' ? 'bg-term! text-green' : 'bg-green!'), i === step && j.phase !== 'Closed' && 'live-dot', i > step && 'text-muted')}>
            {i === 3 && j.phase === 'Disputed' ? 'Jury' : s}{i === step && left ? ` · ${left}` : ''}
          </li>
        ))}
      </ol>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div>
          <span className="label text-muted">Bids</span>
          {j.bids.length === 0 && <p className="mt-2 text-muted">Waiting for sealed bids…</p>}
          <ul className="mt-1 text-sm">
            {j.bids.map((b) => (
              <li key={b.account_id} className={cn('flex justify-between border-t border-line py-1.5', b.account_id === j.winner && 'font-semibold')}>
                <span>{b.account_id === j.winner ? '★ ' : ''}{short(b.account_id)}</span>
                {b.price && <span key={b.price} className="unseal font-mono">{toNear(b.price, 2)} Ⓝ</span>}
                {!b.price && step < 2 && <span className="sealed font-mono">▒▒ {b.hash.slice(0, 6)}</span>}
                {!b.price && step >= 2 && <span className="label text-red">✗ no reveal · bond slashed</span>}
              </li>
            ))}
          </ul>
        </div>
        <div className="md:col-span-2">
          <span className="label text-muted">Deliverable{j.winner ? ` · ${short(j.winner)}` : ''}</span>
          {j.deliverable_uri && j.deliverable_hash ? <Deliverable uri={j.deliverable_uri} hash={j.deliverable_hash} /> : <p className="mt-2 text-muted">Not delivered yet.</p>}
        </div>
      </div>

      {j.question_id !== null && (
        <p className="mt-3 text-sm">
          The contractor rejected this work, so it went to the SOOTH jury:{' '}
          <Link href={`/q/${j.question_id}`} className="font-semibold underline">see the jury's sealed votes, question {j.question_id} →</Link>
        </p>
      )}
      {result && (
        <div className={cn('stamp mt-3 flex flex-wrap justify-between gap-2 border border-ink p-3', result.isBad ? 'bg-red/10' : 'bg-green/40')}>
          <span className="font-semibold">Receipt · {result.text}</span>
          <span className="flex items-center gap-3 font-mono text-sm">
            paid {toNear(paidOut(j).toString())} Ⓝ{j.price ? ` of ${toNear(j.price, 2)} Ⓝ` : ''}
            {j.closed_at && <Timer time={elapsed(j.created_at, j.closed_at)} label="Opened to settled" caption="settled in" className="bg-canvas" />}
          </span>
        </div>
      )}
    </section>
  )
}

function Deliverable({ uri, hash }: { uri: string; hash: string }) {
  const doc = useDoc(uri, hash)
  if (doc.error) return <p className="mt-2 text-red">{doc.error}</p>
  if (!doc.data) return <p className="label mt-2 text-muted">Loading…</p>
  return <DocBody text={doc.data.text} isVerified={doc.data.isVerified} />
}

/** Agent-written text, shown as plain text: never rendered as HTML, so a hidden comment stays visible. */
function DocBody({ text, isVerified }: { text: string; isVerified: boolean }) {
  return (
    <>
      <pre className="unseal mt-2 max-h-72 overflow-auto whitespace-pre-wrap border border-line bg-canvas p-3 font-mono text-xs leading-5">{text}</pre>
      <p className={cn('label mt-1', isVerified ? 'text-muted' : 'text-red')}>
        {isVerified ? 'sha256 matches the hash on chain ✓' : 'Does not match the hash on chain ✗'}
      </p>
    </>
  )
}

function Shell({ children, label, error }: { children: ReactNode; label: string; error?: string | null }) {
  return (
    <main className="mx-auto max-w-[1440px] p-4">
      {error && <p role="alert" className="label mb-3 text-red">Can't reach NEAR testnet. Retrying…</p>}
      <section className="blueprint grid-cols-12" aria-labelledby={label}>{children}</section>
    </main>
  )
}

function Stat({ label, value, unit, isRed = false }: { label: string; value: string; unit?: string; isRed?: boolean }) {
  return (
    <div className="col-span-6 p-4 md:col-span-3">
      <div className="label text-muted">{label}</div>
      <div className={cn('mt-1 font-display text-3xl', isRed && 'text-red')}>
        <Scramble text={value} />{unit && <span className="ml-1.5 font-sans text-base">{unit}</span>}
      </div>
    </div>
  )
}

/** The task owner takes back what the contractor has not spent, once no job is running. */
function CloseTask({ task }: { task: Task }) {
  const { accountId } = useAccount()
  const [state, setState] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null })
  if (accountId !== task.owner || task.status !== 'Open') return null
  const close = async () => {
    setState({ busy: true, note: null })
    try {
      const wallet = await connector.wallet()
      await wallet.signAndSendTransaction({
        receiverId: SWARM,
        actions: [{ type: 'FunctionCall', params: { methodName: 'close_task', args: { task_id: task.id }, gas: '30000000000000', deposit: '1' } }],
      })
      setState({ busy: false, note: 'Closed. The rest of the budget is on its way back to you.' })
    } catch (e) {
      setState({ busy: false, note: e instanceof Error ? e.message : 'The transaction did not go through.' })
    }
  }
  return (
    <div className="col-span-12 flex flex-wrap items-center gap-3 p-4">
      <button type="button" onClick={close} disabled={state.busy || task.active_jobs > 0}
        className="label border border-ink px-3 py-2 hover:bg-ink hover:text-canvas disabled:opacity-50">
        {state.busy ? 'Waiting for your wallet…' : `Close task and take back ${toNear(task.available, 2)} Ⓝ`}
      </button>
      <span className="label text-muted" role="status">
        {state.note ?? (task.active_jobs > 0 ? `You can close it once its ${task.active_jobs} running job${task.active_jobs === 1 ? '' : 's'} settle.` : 'You own this task.')}
      </span>
    </div>
  )
}
