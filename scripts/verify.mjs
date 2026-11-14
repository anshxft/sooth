#!/usr/bin/env node
// Checks the README's claims against NEAR testnet and the live site. Read-only, no install, no keys:
//   node scripts/verify.mjs
// Needs Node 18+ (built-in fetch). Exit code 0 when every check passes.
import { createHash } from 'node:crypto'

const RPC = ['https://rpc.testnet.near.org', 'https://near-testnet.drpc.org']
const SITE = 'https://sooth-wine.vercel.app'
const ORACLE = 'sooth.testnet'
const SWARM = 'sooth-swarm.testnet'
const HONEST = ['atlas', 'nova', 'sage', 'echo'].map((n) => `${n}-sooth.testnet`)
const MALLORY = 'mallory-sooth.testnet'

async function view(contract, method, args = {}) {
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'query',
    params: { request_type: 'call_function', finality: 'final', account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') },
  })
  let last
  for (const url of RPC) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(20_000) })
      const json = await res.json()
      if (json.result?.result) return JSON.parse(Buffer.from(json.result.result).toString())
      last = new Error(JSON.stringify(json.error ?? json.result).slice(0, 200))
    } catch (e) {
      last = e
    }
  }
  throw last
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex')
const near = (yocto) => (Number(BigInt(yocto) / 10n ** 21n) / 1000).toFixed(3)

let failed = 0
async function check(claim, fn) {
  try {
    const detail = await fn()
    console.log(`✓ ${claim}${detail ? `  (${detail})` : ''}`)
  } catch (e) {
    failed++
    console.log(`✗ ${claim}\n    ${e.message}`)
  }
}
const expect = (ok, why) => { if (!ok) throw new Error(why) }

await check('Question 5 (the job 3 dispute) settled NO on its own, with mallory slashed', async () => {
  const q = await view(ORACLE, 'get_question', { question_id: 5 })
  expect(q.status === 'Finalized' && q.outcome.answer === 'NO' && q.outcome.resolved_by === 'auto', `got ${q.status} ${JSON.stringify(q.outcome)}`)
  const m = q.payouts.find((p) => p.account_id === MALLORY)
  expect(m && BigInt(m.delta) < 0n, 'mallory was not slashed')
  return `share ${q.outcome.share_bps / 100}%, mallory ${near(m.delta)} NEAR`
})

await check('Every revealed answer in question 5 links evidence whose sha256 matches the chain', async () => {
  const q = await view(ORACLE, 'get_question', { question_id: 5 })
  const reveals = q.rounds.flatMap((r) => r.reveals)
  for (const r of reveals) {
    const text = await fetch(new URL(r.evidence_uri, SITE)).then((res) => res.text())
    expect(sha256(text) === r.evidence_hash, `${r.account_id}: ${r.evidence_uri} does not match its hash`)
  }
  return `${reveals.length} evidence files`
})

await check('Job 3: the cheapest bid (shade) delivered a fake, lost the dispute, and was banned from task 2', async () => {
  const j = await view(SWARM, 'get_job', { job_id: 3 })
  expect(j.winner === 'shade.sooth-swarm.testnet' && j.result === 'lost_dispute' && j.question_id === 5, `got winner ${j.winner}, result ${j.result}, question ${j.question_id}`)
  const t = await view(SWARM, 'get_task', { task_id: 2 })
  expect(t.banned.includes('shade.sooth-swarm.testnet'), 'shade is not banned from task 2')
  return `won at ${near(j.price)} NEAR`
})

await check("Job 3's deliverable on the site matches its on-chain hash and holds the hidden injection", async () => {
  const j = await view(SWARM, 'get_job', { job_id: 3 })
  const text = await fetch(new URL(j.deliverable_uri, SITE)).then((res) => res.text())
  expect(sha256(text) === j.deliverable_hash, 'hash mismatch')
  expect(/Note to the AI reviewer/i.test(text), 'injection text not found')
})

await check('Job 4 bought the work again from an honest worker, who was paid', async () => {
  const j = await view(SWARM, 'get_job', { job_id: 4 })
  expect(j.task_id === 2 && j.result === 'accepted' && j.winner === 'quill.sooth-swarm.testnet', `got task ${j.task_id}, result ${j.result}, winner ${j.winner}`)
})

await check('Question 3: the bribe held the honest side under 80 %, so round 2 ran and the DAO settled it', async () => {
  const q = await view(ORACLE, 'get_question', { question_id: 3 })
  expect(q.rounds.length === 2 && q.outcome.resolved_by === 'dao', `got ${q.rounds.length} rounds, ${q.outcome?.resolved_by}`)
  return `round 1 share ${q.rounds[0].tally.share_bps / 100}%`
})

await check('The honest agents have never been wrong, and mallory has never been right', async () => {
  const agents = await view(ORACLE, 'list_agents', { from_index: 0, limit: 20 })
  const by = Object.fromEntries(agents.map((a) => [a.account_id, a]))
  for (const id of HONEST) expect(by[id].stats.wrong === 0 && by[id].stats.correct >= 4, `${id}: ${JSON.stringify(by[id].stats)}`)
  const m = by[MALLORY]
  expect(m.stats.correct === 0 && m.stats.wrong >= 4 && m.rep_bps === 5000, `mallory: ${JSON.stringify(m.stats)} rep ${m.rep_bps}`)
  const h = by[HONEST[0]]
  return `honest ${h.stats.correct}/${h.stats.answered} right at ${h.rep_bps / 10000}x; mallory ${m.stats.wrong} wrong, −${near(m.stats.slashed)} NEAR, 0.5x`
})

await check('Question 6 came in the way the Ask page sends it, from an outside account, and the agents settled it', async () => {
  const q = await view(ORACLE, 'get_question', { question_id: 6 })
  expect(q.asker === 'sooth-client.testnet' && q.status === 'Finalized' && q.outcome.resolved_by === 'auto', `got ${q.asker} ${q.status} ${JSON.stringify(q.outcome)}`)
  return `${q.outcome.answer}: ${q.text}`
})

await check('The live site serves every route', async () => {
  for (const path of ['/', '/ask', '/hire', '/swarm', '/agents', '/benchmark', '/build', '/q/5', '/t/2']) {
    const res = await fetch(new URL(path, SITE))
    expect(res.ok, `${path}: HTTP ${res.status}`)
  }
})

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
