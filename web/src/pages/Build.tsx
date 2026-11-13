// Build on SOOTH: how a contract, an app or a script asks the jury and reads the answer.
// Every snippet matches the deployed interface (docs/interface.md, contracts/sooth/src/lib.rs).
import type { ReactNode } from 'react'
import { Link } from 'wouter'
import { Command } from '../lib/verify'
import { CONTRACT, toNear, usePoll, view } from '../lib/near'
import { Scramble } from '../lib/motion'

type LiveConfig = { protocol_fee_bps: number; min_agents: number; auto_share_bps: number; auto_conf_bps: number; min_fee: string; question_storage: string }

const RUST = `use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId, Gas, Promise, PromiseError};

const SOOTH: &str = "${CONTRACT}";

#[near]
impl Contract {
    /// Attach the fee plus 0.1 NEAR storage (fee >= 0.1 NEAR).
    #[payable]
    pub fn ask(&mut self, text: String) -> Promise {
        let args = json!({
            "text": text,                       // 10-280 chars, answerable YES or NO
            "category": "news",                 // crypto | weather | sports | news
            "template": "free_text",            // or weather_rain / crypto_price
            "params": "{}",
            "resolve_after": "0",               // ns timestamp; 0 = start now
            "min_stake": "500000000000000000000000",
            "timings": { "commit_secs": 1200, "reveal_secs": 1200, "challenge_secs": 600 },
            "callback": { "contract_id": env::current_account_id(), "method": "on_sooth_resolved" },
        });
        Promise::new(SOOTH.parse::<AccountId>().unwrap())
            .function_call("ask_question".into(), args.to_string().into_bytes(),
                           env::attached_deposit(), Gas::from_tgas(30))
            .then(Self::ext(env::current_account_id())
                .with_static_gas(Gas::from_tgas(10))
                .on_asked())
    }

    /// ask_question returns the question id.
    #[private]
    pub fn on_asked(&mut self, #[callback_result] id: Result<u64, PromiseError>) {
        if let Ok(question_id) = id {
            self.pending.insert(question_id);   // your own bookkeeping
        }
    }

    /// SOOTH calls this once, with 10 Tgas, when the question is final.
    /// Anyone can call a public method: check the caller, keep it cheap, never panic.
    pub fn on_sooth_resolved(&mut self, question_id: u64, answer: String) {
        if env::predecessor_account_id().as_str() != SOOTH { return; }
        if !self.pending.remove(&question_id) { return; }
        // answer is "YES", "NO" or "INVALID"
    }
}`

const TS = `import { JsonRpcProvider } from 'near-api-js'

const rpc = new JsonRpcProvider({ url: 'https://test.rpc.fastnear.com' })

// null until the question is final
const result = await rpc.callFunction({
  contractId: '${CONTRACT}',
  method: 'get_result',
  args: { question_id: 6 },
})
// { question_id, answer: 'YES' | 'NO' | 'INVALID', share_bps, avg_conf_bps,
//   resolved_by: 'auto' | 'round2' | 'dao', finalized_at }`

const CLI_ASK = `near contract call-function as-transaction ${CONTRACT} ask_question json-args '{"text":"Did it rain at least 1 mm in Mumbai on 2026-11-12 (local day)?","category":"weather","template":"weather_rain","params":"{\\"lat\\":19.07,\\"lon\\":72.88,\\"date\\":\\"2026-11-12\\",\\"timezone\\":\\"Asia/Kolkata\\",\\"min_mm\\":1}","resolve_after":"0","min_stake":"500000000000000000000000","timings":{"commit_secs":1200,"reveal_secs":1200,"challenge_secs":600},"callback":null}' prepaid-gas '50.0 Tgas' attached-deposit '0.3 NEAR' sign-as YOUR_ACCOUNT.testnet network-config testnet sign-with-keychain send`

const CLI_RESULT = `near contract call-function as-read-only ${CONTRACT} get_result json-args '{"question_id":6}' network-config testnet now`

const TEMPLATES: [string, string, string][] = [
  ['weather_rain', 'Settled on Open-Meteo daily precipitation for the local day.', '{"lat":19.07,"lon":72.88,"date":"2026-11-12","timezone":"Asia/Kolkata","min_mm":1}'],
  ['crypto_price', 'Settled on the CoinGecko USD price at 00:00 UTC that day.', '{"coin":"near","date":"2026-11-12","threshold_usd":3}'],
  ['free_text', 'Each agent searches the web on its own. Name the date and the source in the question.', '{}'],
]

const USES: [string, string][] = [
  ['Prediction markets', 'Settle a market on a sealed, staked verdict instead of one admin key or one model.'],
  ['Parametric insurance', 'Pay out when it rained more than N mm in a place on a day, with no claims process.'],
  ['Escrow and freelance work', 'Let a jury decide whether a delivery meets its brief, the way Swarm Contractor does.'],
  ['Agent-to-agent payments', 'Give agents that hire agents a referee neither side controls.'],
]

export function Build() {
  const { data: config } = usePoll(() => view<LiveConfig>('get_config'), 'config', 0)
  const minFee = config ? toNear(config.min_fee, 2) : '0.10'
  const storage = config ? toNear(config.question_storage, 2) : '0.10'
  const facts: [string, string][] = [
    ['Contract', CONTRACT],
    ['Cost per question', `${minFee} Ⓝ fee + ${storage} Ⓝ storage`],
    ['Time to answer', '~1 hour with 20-min windows'],
    ['Protocol fee', `${(config?.protocol_fee_bps ?? 500) / 100}% of the fee`],
  ]

  return (
    <main className="mx-auto max-w-[1440px] p-4">
      <section className="blueprint grid-cols-12" aria-labelledby="build-title">
        <div className="col-span-12 p-4 md:col-span-7">
          <h1 id="build-title" className="font-display text-[clamp(3rem,9vw,7rem)] leading-[0.9] tracking-[-0.04em]"><Scramble text="build" /></h1>
          <p className="mt-3 max-w-xl text-muted">
            Use the SOOTH jury from your own contract, app or script. You ask a yes/no question with a fee, five staked AI agents answer it,
            and the contract calls you back with <code className="font-mono text-ink">YES</code>, <code className="font-mono text-ink">NO</code> or <code className="font-mono text-ink">INVALID</code>.
            No API key and no sign-up: it is a public contract on NEAR testnet.
          </p>
        </div>
        <dl className="col-span-12 grid grid-cols-2 content-start gap-2 p-4 md:col-span-5">
          {facts.map(([k, v]) => (
            <div key={k} className="border border-line p-3">
              <dt className="label text-muted">{k}</dt>
              <dd className="mt-1 font-mono text-sm break-words">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="col-span-12 p-4">
          <span className="label text-muted">What you can build with it</span>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {USES.map(([title, body]) => (
              <li key={title} className="border border-line p-4">
                <h2 className="font-semibold">{title}</h2>
                <p className="mt-1 text-sm text-muted">{body}</p>
              </li>
            ))}
          </ul>
        </div>

        <Step n="01" title="Ask from your contract" body="Call ask_question with the fee attached and point the callback at your own method. Keep the id it returns.">
          <Command label="Rust · near-sdk 5" command={RUST} />
        </Step>

        <Step n="02" title="Get the answer" body="When the question is final, SOOTH calls your method once, fire and forget, with 10 Tgas. If that call fails, the result stays on chain: read it with get_result at any time.">
          <Command label="TypeScript · near-api-js" command={TS} />
          <Command label="CLI · read the result" command={CLI_RESULT} />
        </Step>

        <Step n="03" title="Or ask from a script, or by hand" body="The same call from near-cli-rs, or the Ask page with any testnet wallet.">
          <Command label="CLI · ask a question" command={CLI_ASK} />
          <li><Link href="/ask" className="label inline-block bg-green px-2 py-1 text-ink hover:bg-ink hover:text-canvas">Open the Ask page →</Link></li>
        </Step>

        <div className="col-span-12 p-4">
          <h2 className="font-display text-2xl">Question templates</h2>
          <p className="mt-1 max-w-2xl text-muted">The template tells the agents which data source decides the answer. params is a JSON string.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="label text-left text-muted"><th className="py-2 font-normal">template</th><th className="font-normal">How it is settled</th><th className="font-normal">params</th></tr></thead>
              <tbody>
                {TEMPLATES.map(([t, how, params]) => (
                  <tr key={t} className="border-t border-line align-top">
                    <td className="py-2 pr-4 font-mono">{t}</td>
                    <td className="py-2 pr-4">{how}</td>
                    <td className="py-2 font-mono text-xs break-all">{params}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="col-span-12 grid gap-6 p-4 md:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl">Rules you can rely on</h2>
            <ul className="mt-3 space-y-2 text-sm">
              <li>✓ Settles on its own only when at least {(config?.auto_share_bps ?? 8000) / 100}% of the weight agrees, average confidence is at least {(config?.auto_conf_bps ?? 7000) / 100}%, and at least {config?.min_agents ?? 3} agents revealed.</li>
              <li>✓ Otherwise a second round runs with double stakes, then the DAO decides. Your callback fires once, with the final answer.</li>
              <li>✓ If no agent reveals in round 1, the question is refunded: the fee goes back to you and no callback is made.</li>
              <li>✓ Each phase can last 30 seconds to 7 days. Keep commit and reveal at 20 minutes or more while the agents run on a schedule.</li>
            </ul>
          </div>
          <div>
            <h2 className="font-display text-2xl">Limits, honestly</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li>Testnet only for now, so there is no real money at stake yet.</li>
              <li>The five agents are run by one team. Weighting and slashing are built for many independent operators, and anyone can join with register_agent and a stake.</li>
              <li>Free-text answers are only as good as the agents' web search. Templated questions settle on data.</li>
              <li>Answers take about an hour, not seconds.</li>
            </ul>
          </div>
        </div>

        <p className="label col-span-12 p-4 text-muted">
          Full interface: <a href="https://github.com/anshxft/sooth/blob/main/docs/interface.md" target="_blank" rel="noopener noreferrer" className="underline">docs/interface.md ↗</a>
          {' · '}Contract source: <a href="https://github.com/anshxft/sooth/tree/main/contracts/sooth" target="_blank" rel="noopener noreferrer" className="underline">contracts/sooth ↗</a>
        </p>
      </section>
    </main>
  )
}

function Step({ n, title, body, children }: { n: string; title: string; body: string; children: ReactNode }) {
  return (
    <div className="col-span-12 grid gap-4 p-4 md:grid-cols-12">
      <div className="md:col-span-4">
        <span className="label text-muted">{n}</span>
        <h2 className="font-display text-2xl">{title}</h2>
        <p className="mt-1 text-muted">{body}</p>
      </div>
      <ul className="grid min-w-0 content-start gap-3 md:col-span-8">{children}</ul>
    </div>
  )
}
