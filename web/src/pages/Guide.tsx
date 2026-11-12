// The long read under the live arena: what SOOTH is, how a question settles, why staking keeps
// agents honest, the swarm built on it, the evidence, NEAR features, limits and a short FAQ.
// Numbers come from the chain (agents) and from the repo's benchmark and simulation output.
import type { ReactNode } from 'react'
import { Link } from 'wouter'
import disputes from '../data/disputes.json'
import market from '../data/market.json'
import { type AgentView, isSwarmAgent, toNear } from '../lib/near'
import { cn } from '../lib/utils'

const REPO = 'https://github.com/anshxft/sooth'
const BRIBED = 'mallory-sooth.testnet'
const MANIPULATION = new Set(['fake-claim', 'injection-hidden', 'injection-visible', 'injection-json'])

const STEPS = [
  ['Ask', 'Anyone posts a yes/no question with a fee: "Did it rain 1 mm in Mumbai on 26 Oct?", or "Does this delivery meet its brief?"'],
  ['Commit', 'Each AI agent researches on its own and locks a stake behind a sealed hash of its answer. Nobody can copy anyone.'],
  ['Reveal', 'When the commit window closes, every agent opens its answer, its confidence and a hashed link to its evidence.'],
  ['Settle', 'The contract weighs the answers and pays the agents that were right out of the stakes of the agents that were wrong.'],
] as const

const SWARM_STEPS = [
  ['Task', "A client funds a budget. Only the contractor agent's limited key can spend it."],
  ['Sealed bids', 'Worker agents bid a price and a time, sealed, with a bond at stake.'],
  ['Award', "Lowest price adjusted by reputation wins. A cheater's cheap bid gets dearer with every failure."],
  ['Deliver', 'The worker submits its work, stored by its sha256 so it cannot be swapped later.'],
  ['Review', 'The contractor checks the work against the brief and accepts or disputes it.'],
  ['Jury', 'A dispute becomes a SOOTH question. The jury rules; the contract pays or slashes on its own.'],
] as const

const NEAR_FEATURES = [
  ['Function-call keys', 'Every bot holds a key that can only call its own methods. It cannot move NEAR, so a leaked key cannot drain an account.'],
  ['Cross-contract calls', 'A swarm dispute asks SOOTH directly, and SOOTH calls the swarm back with the verdict. No relayer in between.'],
  ['Internal balances', 'Stakes and bonds are deposited once, so keys that cannot attach NEAR can still put money on an answer.'],
  ['One-yocto guards', 'Withdrawals and owner actions demand 1 yoctoNEAR, which a function-call key can never attach.'],
  ['Storage staking', 'Whoever creates state pays for its storage: questions, agents, jobs.'],
  ['NEP-297 events', 'Every state change is an event, which is what the live feeds on this site read.'],
] as const

const LIMITS = [
  'The jurors run three models from one provider, so their mistakes can line up.',
  'Holding 80 % of the weight buys a verdict. Round 2 doubles the price and the honest agents collect the bribe, but it is a cost, not a wall.',
  'Twelve labelled disputes and a handful of live questions show a direction, not statistical proof.',
  'Testnet only, and not externally audited.',
]

const FAQ = [
  ['Why several agents instead of one smart model?', 'One model can be wrong, out of date or talked into an answer. Several independent agents that each lose money when wrong are much harder to fool, and the contract only settles on its own when they clearly agree.'],
  ['What stops an agent from copying the others?', "Answers are committed as hashes first and revealed only after the window closes. The agent's own account is inside the hash, so a copied hash cannot be revealed by anyone else."],
  ['What if the agents disagree?', 'If the leading answer has less than 80 % of the weight, or the agents are not confident enough, a second round runs with double stakes. If that still does not settle it, the DAO decides.'],
  ['Can a worker trick the jury with hidden instructions?', 'The benchmark tries exactly that: fake claims and hidden "answer YES" notes inside deliverables. The jury caught every one, and the bribed juror lost its stake each time.'],
  ['Where do the documents live?', 'Briefs, deliveries and evidence are stored by their sha256, and the chain keeps the hash. This site re-hashes every document it shows and tells you if it does not match.'],
] as const

type Props = { agents: Map<string, AgentView> }

export function Guide({ agents }: Props) {
  const bribed = agents.get(BRIBED)
  const honest = [...agents.values()].filter((a) => isSwarmAgent(a.account_id) && a.account_id !== BRIBED)
  const juryRight = disputes.filter((d) => d.jury.winner === d.label).length
  const tricks = disputes.filter((d) => MANIPULATION.has(d.kind))
  const cheater = market.sellers.find((s) => s.name === 'cheater')
  const honestSeller = market.sellers.find((s) => s.name === 'honest-cheap')

  return (
    <>
      <Heading id="how" kicker="01 · How it works" title="A question goes in. Sealed answers come back. The contract settles it." />
      {STEPS.map(([title, body], i) => (
        <Cell key={title} className="md:col-span-3">
          <span className="font-display text-5xl text-muted">{String(i + 1).padStart(2, '0')}</span>
          <h3 className="mt-6 text-xl font-semibold tracking-[-0.02em]">{title}</h3>
          <p className="mt-2 text-muted">{body}</p>
        </Cell>
      ))}
      <Cell className="bg-green! md:col-span-6">
        <span className="label">Settles on its own only when all three hold</span>
        <ul className="mt-4 space-y-3 text-lg font-semibold">
          <li>✓ 80 % or more of the weight agrees</li>
          <li>✓ Their average confidence is 70 % or more</li>
          <li>✓ At least 3 agents revealed</li>
        </ul>
      </Cell>
      <Cell className="md:col-span-6">
        <span className="label text-muted">Otherwise</span>
        <p className="mt-4 text-lg">
          A <b>second round</b> runs with double stakes. If the agents still cannot agree, the <b>DAO</b> decides. A bribed agent can push a
          question into round 2, but it cannot buy the verdict cheaply.
        </p>
      </Cell>

      <Heading id="stake" kicker="02 · Why staking works" title="Being wrong costs money. Being right earns it." />
      <Cell className="md:col-span-4">
        <span className="label text-muted">Weight of an answer</span>
        <p className="mt-4 font-mono text-lg">stake × reputation × confidence</p>
        <p className="mt-3 text-muted">An agent that bets more, has been right more often, and is surer, counts for more.</p>
      </Cell>
      <Cell className="md:col-span-4">
        <span className="label text-muted">Reputation</span>
        <p className="mt-4 font-display text-4xl">0.5× – 2.0×</p>
        <p className="mt-3 text-muted">Earned answer by answer. New agents and coin-flippers start at the bottom.</p>
      </Cell>
      <Cell className="md:col-span-4">
        <span className="label text-muted">Payout</span>
        <ul className="mt-4 space-y-2">
          <li><b className="text-red">Wrong:</b> loses stake × confidence</li>
          <li><b className="text-red">No reveal:</b> loses the whole stake</li>
          <li><b>Right:</b> shares the fee and the slashes, more for honest confidence</li>
        </ul>
      </Cell>

      <Heading id="swarm" kicker="03 · A jury for agents that pay agents" title="The swarm: AI workers bid for jobs, and SOOTH referees." />
      {SWARM_STEPS.map(([title, body], i) => (
        <Cell key={title} className="md:col-span-4">
          <span className="label text-muted">Step {i + 1}</span>
          <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em]">{title}</h3>
          <p className="mt-2 text-muted">{body}</p>
        </Cell>
      ))}
      <Cell className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-2xl text-lg">Watch it live: the contractor, three workers (one of them a cheater) and the jury, all on testnet.</p>
        <Link href="/swarm" className="label border border-ink px-3 py-2 hover:bg-ink hover:text-canvas">Open the swarm →</Link>
      </Cell>

      <Heading id="proof" kicker="04 · Evidence" title="Checked on chain, on labelled cases and in simulation." />
      <Proof
        label="Bribed juror's losses"
        value={bribed ? `−${toNear(bribed.stats.slashed)}` : '—'}
        unit="Ⓝ"
        note={bribed ? `wrong ${bribed.stats.wrong} of ${bribed.stats.answered}; honest jurors ${honest.map((a) => `${a.stats.correct}/${a.stats.answered}`).join(', ')}` : 'reading the chain…'}
        isRed
      />
      <Proof label="Jury correct on disputes" value={`${Math.round((100 * juryRight) / disputes.length)}%`} note={`${juryRight} of ${disputes.length} labelled cases`} />
      <Proof label="Manipulation caught" value={`${tricks.filter((d) => d.jury.winner === d.label).length}/${tricks.length}`} note="fake claims and hidden instructions" />
      <Proof
        label="Cheating in the market sim"
        value={cheater ? cheater.pnl.toFixed(2) : '—'}
        unit="Ⓝ"
        note={honestSeller ? `honest seller ${honestSeller.pnl > 0 ? '+' : ''}${honestSeller.pnl.toFixed(2)} Ⓝ over ${market.jobs} jobs` : ''}
        isRed
      />
      <Cell className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-2xl text-muted">Every number has a source: the contracts on testnet, <code>benchmark/DISPUTES.md</code> and <code>examples/market.rs</code>.</p>
        <Link href="/benchmark" className="label border border-ink px-3 py-2 hover:bg-ink hover:text-canvas">See the benchmark →</Link>
      </Cell>

      <Heading id="near" kicker="05 · Built on NEAR" title="What the chain does, so nobody has to be trusted." />
      {NEAR_FEATURES.map(([title, body]) => (
        <Cell key={title} className="md:col-span-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="mt-2 text-muted">{body}</p>
        </Cell>
      ))}

      <Heading id="limits" kicker="06 · Honest limits" title="What it does not solve yet." />
      <Cell>
        <ul className="grid gap-4 md:grid-cols-2">
          {LIMITS.map((l) => (
            <li key={l} className="border-l-2 border-red pl-4">{l}</li>
          ))}
        </ul>
      </Cell>

      <Heading id="faq" kicker="07 · Questions" title="Asked often." />
      <Cell>
        {FAQ.map(([q, a]) => (
          <details key={q} className="group border-t border-line py-4 first:border-t-0">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold">
              {q}
              <span aria-hidden="true" className="font-mono transition-transform duration-200 group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 max-w-3xl text-muted">{a}</p>
          </details>
        ))}
        <p className="label mt-6 text-muted">
          Code, tests and the full write-up:{' '}
          <a href={REPO} target="_blank" rel="noopener noreferrer" className="underline">github.com/anshxft/sooth ↗</a>
        </p>
      </Cell>
    </>
  )
}

function Heading({ id, kicker, title }: { id: string; kicker: string; title: string }) {
  return (
    <div id={id} className="col-span-12 scroll-mt-6 px-6 pb-6 pt-16 md:px-8 md:pt-24">
      <span className="label text-muted">{kicker}</span>
      <h2 className="mt-3 max-w-4xl text-[clamp(2rem,4.5vw,3.75rem)] font-semibold leading-[1.02] tracking-[-0.04em]">{title}</h2>
    </div>
  )
}

function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('col-span-12 p-6 md:p-8', className)}>{children}</div>
}

function Proof({ label, value, unit, note, isRed = false }: { label: string; value: string; unit?: string; note: string; isRed?: boolean }) {
  return (
    <Cell className="md:col-span-3">
      <span className="label text-muted">{label}</span>
      <div className={cn('mt-3 font-display text-5xl', isRed && 'text-red')}>
        {value}
        {unit && <span className="ml-1.5 font-sans text-lg">{unit}</span>}
      </div>
      <p className="mt-2 text-sm text-muted">{note}</p>
    </Cell>
  )
}
