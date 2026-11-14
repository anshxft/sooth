import { lazy, Suspense, useEffect } from 'react'
import { Link, Route, Switch, useLocation } from 'wouter'
import { Dock, ThemeToggle } from './lib/dock'
import { Backdrop } from './lib/motion'
import { useAccount } from './lib/near'
import { AgentsStatus } from './lib/status'
import { Arena } from './pages/Arena'

// Arena is the landing page; the rest load on first visit.
const Agents = lazy(() => import('./pages/Agents').then((m) => ({ default: m.Agents })))
const Ask = lazy(() => import('./pages/Ask').then((m) => ({ default: m.Ask })))
const Hire = lazy(() => import('./pages/Hire').then((m) => ({ default: m.Hire })))
const Build = lazy(() => import('./pages/Build').then((m) => ({ default: m.Build })))
const Benchmark = lazy(() => import('./pages/Benchmark').then((m) => ({ default: m.Benchmark })))
const Question = lazy(() => import('./pages/Question').then((m) => ({ default: m.Question })))
const Swarm = lazy(() => import('./pages/Swarm').then((m) => ({ default: m.Swarm })))
const TaskPage = lazy(() => import('./pages/Swarm').then((m) => ({ default: m.TaskPage })))

// Tab titles per route, so history, bookmarks and shared tabs say which page is which.
const SITE = 'SOOTH'
function titleFor(path: string): string {
  if (path.startsWith('/q/')) return `Question ${path.slice(3)} · ${SITE}`
  if (path.startsWith('/t/')) return `Task ${path.slice(3)} · ${SITE}`
  const page: Record<string, string> = { '/ask': 'Ask the jury', '/swarm': 'Swarm', '/agents': 'Agents', '/benchmark': 'Benchmark', '/build': 'Build on SOOTH', '/hire': 'Hire the swarm' }
  if (path === '/') return `${SITE} — Many agents. One truth.`
  return page[path] ? `${page[path]} · ${SITE}` : `Page not found · ${SITE}`
}

export default function App() {
  const { accountId, signIn, signOut } = useAccount()
  const [location] = useLocation()
  useEffect(() => {
    document.title = titleFor(location)
  }, [location])
  return (
    <>
      <Backdrop />
      <header className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 pt-4">
        <Link href="/" className="font-display text-xl tracking-[-0.04em]">sooth</Link>
        <div className="flex items-center gap-3">
          <AgentsStatus />
          <span className="label text-muted">Testnet</span>
          <button
            type="button"
            onClick={accountId ? signOut : signIn}
            className="wallet label rounded-full bg-green px-4 py-2 text-ink transition-transform duration-150 active:scale-[0.96]"
          >
            {accountId ? <><span className="inline-block max-w-[9rem] truncate align-bottom sm:max-w-[16rem]">{accountId}</span> ×</> : <>Connect wallet <span className="wallet-arrow" aria-hidden="true">→</span></>}
          </button>
          <ThemeToggle />
        </div>
      </header>
      {/* Bottom padding keeps the last row clear of the dock. */}
      <div className="pb-24">
        <Suspense fallback={<p className="label mx-auto max-w-[1440px] p-4 text-muted">Loading…</p>}>
        <Switch>
          <Route path="/" component={Arena} />
          <Route path="/q/:id">{(params) => <Question id={params.id} />}</Route>
          <Route path="/agents" component={Agents} />
          <Route path="/swarm" component={Swarm} />
          <Route path="/t/:id">{(params) => <TaskPage id={params.id} />}</Route>
          <Route path="/ask" component={Ask} />
          <Route path="/hire" component={Hire} />
          <Route path="/build" component={Build} />
          <Route path="/benchmark" component={Benchmark} />
          <Route>
            <main className="mx-auto max-w-[1440px] p-4">
              <h1 className="font-display text-[clamp(2.5rem,7vw,5rem)] leading-none tracking-[-0.04em]">404</h1>
              <p className="label mt-3">Page not found. <Link href="/" className="underline">Back to arena</Link></p>
            </main>
          </Route>
        </Switch>
        </Suspense>
      </div>
      <Dock />
    </>
  )
}
