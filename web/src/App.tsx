import { Link, Route, Switch } from 'wouter'
import { useAccount } from './lib/near'
import { Agents } from './pages/Agents'
import { Arena } from './pages/Arena'
import { Question } from './pages/Question'
import { Swarm, TaskPage } from './pages/Swarm'

const NAV = [
  ['/', 'Arena'],
  ['/swarm', 'Swarm'],
  ['/agents', 'Agents'],
  ['/benchmark', 'Benchmark'],
  ['/ask', 'Ask'],
] as const

export default function App() {
  const { accountId, signIn, signOut } = useAccount()
  return (
    <>
      <header className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-4 pt-4">
        <Link href="/" className="font-display text-xl tracking-[-0.04em]">sooth</Link>
        <nav aria-label="Main" className="label hidden gap-6 md:flex">
          {NAV.map(([href, label]) => <Link key={href} href={href} className="hover:underline">{label}</Link>)}
        </nav>
        <div className="flex items-center gap-3">
          <span className="label text-muted">Testnet</span>
          <button
            type="button"
            onClick={accountId ? signOut : signIn}
            className="label rounded-full bg-green px-4 py-2 text-ink transition-transform active:scale-[0.97]"
          >
            {accountId ? `${accountId} ×` : 'Connect wallet →'}
          </button>
        </div>
      </header>
      <Switch>
        <Route path="/" component={Arena} />
        <Route path="/q/:id">{(params) => <Question id={params.id} />}</Route>
        <Route path="/agents" component={Agents} />
        <Route path="/swarm" component={Swarm} />
        <Route path="/t/:id">{(params) => <TaskPage id={params.id} />}</Route>
        <Route>
          {/* ponytail: placeholder until the Benchmark / Ask pages land */}
          <main className="mx-auto max-w-[1280px] p-4">
            <p className="label">Coming next. <Link href="/" className="underline">Back to arena</Link></p>
          </main>
        </Route>
      </Switch>
    </>
  )
}
