import { Link, Route, Switch } from 'wouter'
import { Dock, ThemeToggle } from './lib/dock'
import { Backdrop } from './lib/motion'
import { useAccount } from './lib/near'
import { Agents } from './pages/Agents'
import { Arena } from './pages/Arena'
import { Benchmark } from './pages/Benchmark'
import { Question } from './pages/Question'
import { Swarm, TaskPage } from './pages/Swarm'

export default function App() {
  const { accountId, signIn, signOut } = useAccount()
  return (
    <>
      <Backdrop />
      <header className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-4 pt-4">
        <Link href="/" className="font-display text-xl tracking-[-0.04em]">sooth</Link>
        <div className="flex items-center gap-3">
          <span className="label text-muted">Testnet</span>
          <button
            type="button"
            onClick={accountId ? signOut : signIn}
            className="wallet label rounded-full bg-green px-4 py-2 text-ink transition-transform duration-150 active:scale-[0.96]"
          >
            {accountId ? `${accountId} ×` : <>Connect wallet <span className="wallet-arrow" aria-hidden="true">→</span></>}
          </button>
          <ThemeToggle />
        </div>
      </header>
      {/* Bottom padding keeps the last row clear of the dock. */}
      <div className="pb-24">
        <Switch>
          <Route path="/" component={Arena} />
          <Route path="/q/:id">{(params) => <Question id={params.id} />}</Route>
          <Route path="/agents" component={Agents} />
          <Route path="/swarm" component={Swarm} />
          <Route path="/t/:id">{(params) => <TaskPage id={params.id} />}</Route>
          <Route path="/benchmark" component={Benchmark} />
          <Route>
            <main className="mx-auto max-w-[1280px] p-4">
              <p className="label">Page not found. <Link href="/" className="underline">Back to arena</Link></p>
            </main>
          </Route>
        </Switch>
      </div>
      <Dock />
    </>
  )
}
