// Contract reads, wallet and polling hooks. Shapes follow docs/interface.md §3.
import { useEffect, useState } from 'react'
import { NearConnector } from '@hot-labs/near-connect'
import { JsonRpcProvider } from 'near-api-js'

export const CONTRACT = 'sooth.testnet'
const POLL_MS = 3_000
const provider = new JsonRpcProvider({ url: 'https://test.rpc.fastnear.com' })
export const connector = new NearConnector({ network: 'testnet' })

export type Answer = 'YES' | 'NO' | 'INVALID'
export type Phase =
  | 'Scheduled' | 'Commit' | 'Reveal' | 'AwaitingTally' | 'Challenge' | 'AwaitingFinalize' | 'Dao' | 'Finalized' | 'Refunded'
export type Outcome = { answer: Answer; share_bps: number; avg_conf_bps: number; resolved_by: 'auto' | 'round2' | 'dao' }
export type Commit = { account_id: string; hash: string; stake: string; committed_at: string }
export type Reveal = {
  account_id: string; answer: Answer; confidence: number; weight: string; rep_bps: number; evidence_hash: string; evidence_uri: string; revealed_at: string
}
export type Tally = {
  weights: Record<Answer, string>; winner: Answer | null; share_bps: number; avg_conf_bps: number; revealed: number; confident: boolean; tallied_at: string
}
export type Round = { round: number; min_stake: string; commit_start: string; commit_end: string; reveal_end: string; commits: Commit[]; reveals: Reveal[]; tally: Tally | null }
export type Payout = { account_id: string; round: number; stake: string; delta: string; reason: 'correct' | 'wrong' | 'no_reveal' | 'challenge_won' | 'challenge_lost' }
type QuestionBase = { id: number; text: string; category: string; status: string; phase: Phase; round: number; fee: string; resolve_after: string; outcome: Outcome | null }
export type QuestionSummary = QuestionBase & { phase_ends_at: string | null; commits: number; reveals: number }
export type QuestionView = QuestionBase & {
  asker: string; template: string; params: string; created_at: string; timings: { commit_secs: number; reveal_secs: number; challenge_secs: number }
  rounds: Round[]; challenge_end: string | null; payouts: Payout[]; protocol_fee: string | null; dust: string | null; finalized_at: string | null
  phase_ends_at?: string | null // not in get_question; Arena copies it from the list summary
}
export type Config = { protocol_fee_bps: number; min_agents: number; auto_share_bps: number; auto_conf_bps: number; treasury: string; dao_account: string }
export type AgentView = {
  account_id: string; name: string; model: string; free_balance: string; locked_balance: string; rep_bps: number; accuracy_bps: number
  stats: { answered: number; correct: number; wrong: number; no_reveal: number; earned: string; slashed: string }
}

export const view = <T,>(method: string, args: Record<string, unknown> = {}) =>
  provider.callFunction({ contractId: CONTRACT, method, args }) as Promise<T>

/** yoctoNEAR string -> "1.234" (rounded down to `digits`). */
export function toNear(yocto: string, digits = 3): string {
  const scale = 10n ** BigInt(24 - digits)
  const units = BigInt(yocto) / scale
  const negative = units < 0n
  const abs = negative ? -units : units
  const whole = abs / 10n ** BigInt(digits)
  const frac = (abs % 10n ** BigInt(digits)).toString().padStart(digits, '0')
  return `${negative ? '−' : ''}${whole}.${frac}`
}

export const nsToMs = (ns: string) => Number(BigInt(ns) / 1_000_000n)
export const pct = (bps: number) => (bps / 100).toFixed(1)
export const qid = (id: number) => `Q-${String(id).padStart(4, '0')}`

/** "mm:ss" left until `endsAtNs`, or '' when there is no deadline. */
export function countdown(endsAtNs: string | null | undefined, now: number): string {
  if (!endsAtNs) return ''
  const s = Math.max(0, Math.round((nsToMs(endsAtNs) - now) / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Re-runs `load` every `everyMs` (0 = load once); keeps the last good value when a poll fails. */
export function usePoll<T>(load: () => Promise<T>, key: string, everyMs = POLL_MS): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const run = () =>
      load()
        .then((value) => alive && (setData(value), setError(null)))
        .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Request failed'))
    run()
    const id = everyMs > 0 ? setInterval(run, everyMs) : undefined
    return () => {
      alive = false
      clearInterval(id)
    }
    // `key` identifies what `load` fetches; the closure itself changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return { data, error }
}

const AGENTS_POLL_MS = 30_000

/** Registered agents by account id (name, model, rep). Changes slowly, so polled rarely. */
export function useAgents(): Map<string, AgentView> {
  const { data } = usePoll(() => view<AgentView[]>('leaderboard', { limit: 50 }), 'agents', AGENTS_POLL_MS)
  return new Map((data ?? []).map((a) => [a.account_id, a]))
}

/** Current time, ticking once a second (for countdowns). */
export function useNow(): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** Signed-in account via NEAR Connect; restores the session after a reload. */
export function useAccount(): { accountId: string | null; signIn: () => void; signOut: () => void } {
  const [accountId, setAccountId] = useState<string | null>(null)
  useEffect(() => {
    const onIn = ({ accounts }: { accounts: { accountId: string }[] }) => setAccountId(accounts[0]?.accountId ?? null)
    const onOut = () => setAccountId(null)
    connector.on('wallet:signIn', onIn)
    connector.on('wallet:signOut', onOut)
    connector
      .getConnectedWallet()
      .then(({ accounts }) => setAccountId(accounts[0]?.accountId ?? null))
      .catch(() => setAccountId(null)) // nobody signed in yet
    return () => {
      connector.off('wallet:signIn', onIn)
      connector.off('wallet:signOut', onOut)
    }
  }, [])
  return {
    accountId,
    signIn: () => void connector.connect().catch(() => undefined), // closing the modal is not an error
    signOut: () => void connector.disconnect().catch(() => undefined),
  }
}
