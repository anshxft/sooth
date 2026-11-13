// Exit 0 when an agent is mid-way through something a missed pass would punish: a sealed answer
// or bid not yet revealed, or a delivery due. The Actions loop keeps running while this holds.
import { config, rpc } from './lib.mts'

const OPEN_QUESTION = new Set(['Commit', 'Reveal'])
const OPEN_JOB = new Set(['BidCommit', 'BidReveal', 'Delivering'])

const view = <T,>(contractId: string, method: string, args: object) => rpc.callFunction({ contractId, method, args }) as Promise<T>

const [questions, jobs] = await Promise.all([
  view<{ id: number; phase: string }[]>(config.contract, 'list_questions', { limit: 20 }),
  view<{ id: number; phase: string }[]>(config.swarm.contract, 'list_jobs', { limit: 30 }),
])
const busy = [
  ...questions.filter((q) => OPEN_QUESTION.has(q.phase)).map((q) => `question ${q.id} ${q.phase}`),
  ...jobs.filter((j) => OPEN_JOB.has(j.phase)).map((j) => `job ${j.id} ${j.phase}`),
]
console.log(busy.length ? `busy: ${busy.join(', ')}` : 'idle')
process.exit(busy.length ? 0 : 1)
