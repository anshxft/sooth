import { Link, Route, Switch } from 'wouter'
import { Backdrop, Cursor } from './lib/motion'
import { useAccount } from './lib/near'
import { Agents } from './pages/Agents'
import { Arena } from './pages/Arena'
import { Benchmark } from './pages/Benchmark'
import { Question } from './pages/Question'
import { Swarm, TaskPage } from './pages/Swarm'

const NAV = [
  ['/', 'Arena'],
  ['/swarm', 'Swarm'],
  ['/agents', 'Agents'],
  ['/benchmark', 'Benchmark'],
] as const

export default function App() {
  const { accountId, signIn, signOut } = useAccount()
  return (
    <>
      <Backdrop />
      <Cursor />
      <header className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 pt-4">
        <Link href="/" className="font-display text-xl tracking-[-0.04em]">sooth</Link>
        <nav aria-label="Main" className="label order-last flex w-full gap-5 md:order-none md:w-auto md:gap-6">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className={(active) => (active ? 'border-b-2 border-ink' : 'text-muted hover:text-ink')}>{label}</Link>
          ))}
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
        <Route path="/benchmark" component={Benchmark} />
        <Route>
          <main className="mx-auto max-w-[1280px] p-4">
            <p className="label">Page not found. <Link href="/" className="underline">Back to arena</Link></p>
          </main>
        </Route>
      </Switch>
    </>
  )
}
