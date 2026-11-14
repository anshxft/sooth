import { lazy, Suspense, useEffect } from 'react'
import { Link, Route, Switch, useLocation } from 'wouter'
import { Dock, ThemeToggle } from './lib/dock'
import { Backdrop } from './lib/motion'
import { useAccount } from './lib/near'
import { AgentsStatus } from './lib/status'
import { MyRequests } from './lib/mine'
import { useTextReveal } from './lib/reveal'
import { useHoverText } from './lib/hovertext'
import { useSmoothScroll } from './lib/smooth'
import { shortAccount } from './lib/utils'
import { Arena } from './pages/Arena'
import { PageFooter } from './lib/footer'
import { PageLoader } from './lib/loader'

// Arena is the landing page; every other page is its own chunk. Each chunk is fetched once (the
// promise is kept), and all of them are fetched in the background soon after the first page is up,
// so opening a section later shows it at once instead of a blank "Loading…".
const once = <T,>(load: () => Promise<T>) => { let p: Promise<T> | undefined; return () => (p ??= load()) }
const PAGES = {
  agents: once(() => import('./pages/Agents')),
  ask: once(() => import('./pages/Ask')),
  hire: once(() => import('./pages/Hire')),
  build: once(() => import('./pages/Build')),
  benchmark: once(() => import('./pages/Benchmark')),
  question: once(() => import('./pages/Question')),
  docs: once(() => import('./pages/Docs')),
  swarm: once(() => import('./pages/Swarm')),
}
const PREFETCH_AFTER_MS = 1500
const Agents = lazy(() => PAGES.agents().then((m) => ({ default: m.Agents })))
const Ask = lazy(() => PAGES.ask().then((m) => ({ default: m.Ask })))
const Hire = lazy(() => PAGES.hire().then((m) => ({ default: m.Hire })))
const Build = lazy(() => PAGES.build().then((m) => ({ default: m.Build })))
const Benchmark = lazy(() => PAGES.benchmark().then((m) => ({ default: m.Benchmark })))
const Question = lazy(() => PAGES.question().then((m) => ({ default: m.Question })))
const Docs = lazy(() => PAGES.docs().then((m) => ({ default: m.Docs })))
const Swarm = lazy(() => PAGES.swarm().then((m) => ({ default: m.Swarm })))
const TaskPage = lazy(() => PAGES.swarm().then((m) => ({ default: m.TaskPage })))

// Tab titles per route, so history, bookmarks and shared tabs say which page is which.
const SITE = 'SOOTH'
function titleFor(path: string): string {
  if (path.startsWith('/q/')) return `Question ${path.slice(3)} · ${SITE}`
  if (path.startsWith('/t/')) return `Task ${path.slice(3)} · ${SITE}`
  const page: Record<string, string> = { '/ask': 'Ask the jury', '/swarm': 'Swarm', '/agents': 'Agents', '/benchmark': 'Benchmark', '/build': 'Build on SOOTH', '/hire': 'Hire the swarm', '/docs': 'Docs' }
  if (path === '/') return `${SITE} — Many agents. One truth.`
  return page[path] ? `${page[path]} · ${SITE}` : `Page not found · ${SITE}`
}

export default function App() {
  const { accountId, signIn, signOut } = useAccount()
  const [location] = useLocation()
  useSmoothScroll()
  useTextReveal(location)
  useHoverText(location)
  useEffect(() => {
    document.title = titleFor(location)
  }, [location])
  useEffect(() => {
    const timer = setTimeout(() => Object.values(PAGES).forEach((load) => { load().catch(() => {}) }), PREFETCH_AFTER_MS) // a failed prefetch just loads on click
    return () => clearTimeout(timer)
  }, [])
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
            className="wallet btn btn-sm"
          >
            {accountId ? <><span title={accountId} className="inline-block max-w-[9rem] truncate align-bottom sm:max-w-[16rem]">{shortAccount(accountId)}</span> ×</> : <>Connect wallet <span className="wallet-arrow" aria-hidden="true">→</span></>}
          </button>
          <ThemeToggle />
        </div>
      </header>
      {/* Bottom padding keeps the last row clear of the dock. */}
      <div className="pb-24">
        <Suspense fallback={<PageLoader />}>
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
          <Route path="/docs" component={Docs} />
          <Route>
            <main className="mx-auto max-w-[1440px] p-4">
              <h1 className="font-display text-[clamp(2.5rem,7vw,5rem)] leading-none tracking-[-0.04em]">404</h1>
              <p className="label mt-3">Page not found. <Link href="/" className="underline">Back to arena</Link></p>
            </main>
          </Route>
        </Switch>
          {location !== '/' && <PageFooter />}
        </Suspense>
      </div>
      <MyRequests />
      <Dock />
    </>
  )
}
