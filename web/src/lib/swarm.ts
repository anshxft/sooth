// Reads for the job market contract (contracts/swarm). Polling and formatting live in near.ts.
import { JsonRpcProvider } from 'near-api-js'
import { usePoll } from './near'

export const SWARM = 'sooth-swarm.testnet'
const provider = new JsonRpcProvider({ url: 'https://test.rpc.fastnear.com' })

export type JobPhase =
  | 'BidCommit' | 'BidReveal' | 'AwaitingAward' | 'Delivering' | 'DeliveryMissed' | 'Review' | 'Claimable' | 'Disputed' | 'Closed'
export type JobResult = 'no_bids' | 'accepted' | 'claimed' | 'won_dispute' | 'lost_dispute' | 'split' | 'missed_delivery'
export type Bid = { account_id: string; hash: string; committed_at: string; price: string | null; eta_secs: number | null }
export type Job = {
  id: number; task_id: number; brief_uri: string; brief_hash: string; max_price: string; phase: JobPhase; status: string
  created_at: string; commit_end: string; reveal_end: string; bids: Bid[]; winner: string | null; price: string | null
  delivery_end: string | null; deliverable_uri: string | null; deliverable_hash: string | null; review_end: string | null
  question_id: number | null; dispute_deadline: string | null; result: JobResult | null; closed_at: string | null
}
export type Task = {
  id: number; owner: string; contractor: string; brief_uri: string; brief_hash: string; budget: string; paid: string
  reserved: string; costs: string; active_jobs: number; banned: string[]; status: 'Open' | 'Closed'; created_at: string; available: string
}
export type Worker = {
  account_id: string; name: string; free_balance: string; locked_balance: string; rep_bps: number
  stats: { jobs: number; successful: number; failed: number; no_reveal: number; earned: string; slashed: string }
}

export const swarmView = <T,>(method: string, args: Record<string, unknown> = {}) =>
  provider.callFunction({ contractId: SWARM, method, args }) as Promise<T>

/** Where the deadline of the current phase is stored. */
export function jobPhaseEnd(j: Job): string | null {
  if (j.phase === 'BidCommit') return j.commit_end
  if (j.phase === 'BidReveal') return j.reveal_end
  if (j.phase === 'Delivering') return j.delivery_end
  if (j.phase === 'Review') return j.review_end
  if (j.phase === 'Disputed') return j.dispute_deadline
  return null
}

/** What the winning worker was paid when the job closed, in yoctoNEAR. Mirrors settle_job in the contract. */
export function paidOut(j: Job): bigint {
  const price = BigInt(j.price ?? '0')
  if (j.result === 'accepted' || j.result === 'claimed' || j.result === 'won_dispute') return price
  if (j.result === 'split') return price / 2n
  return 0n
}

export type Doc = { text: string; isVerified: boolean }

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A document from the store, checked against the hash the contract holds. */
export function useDoc(uri: string | null, hash: string | null): { data: Doc | null; error: string | null } {
  return usePoll(
    async () => {
      if (!uri || !hash) return null
      const res = await fetch(uri)
      if (!res.ok) throw new Error(`Document unavailable (HTTP ${res.status})`)
      const text = await res.text()
      return { text, isVerified: (await sha256Hex(text)) === hash }
    },
    `doc${hash}`,
    0,
  )
}
