// Ask the jury: a signed-in visitor posts their own yes/no question to sooth.testnet and the agents
// answer it on chain. Three kinds: rain (Open-Meteo), crypto price (CoinGecko) and free text (web search).
import { type FormEvent, useState } from 'react'
import { useLocation } from 'wouter'
import { CONTRACT, connector, useAccount } from '../lib/near'
import { cn } from '../lib/utils'
import { Scramble } from '../lib/motion'

type Kind = 'free' | 'rain' | 'crypto'
type Draft = { text: string; category: 'news' | 'weather' | 'crypto'; template: 'free_text' | 'weather_rain' | 'crypto_price'; params: string }

const YOCTO_PER_MILLI = 10n ** 21n
const STORAGE_MILLI = 100 // config.question_storage: pays for the question's bytes on chain
const MIN_FEE = 0.1
const MIN_STAKE = '500000000000000000000000' // 0.5 NEAR per agent, as in every question so far
// Scheduled agents can start a few minutes late, so commit and reveal get 20 minutes each.
const TIMINGS = { commit_secs: 1200, reveal_secs: 1200, challenge_secs: 600 }
const GAS = '50000000000000' // 50 Tgas
const DAY_MS = 86_400_000
const COINS = [['near', 'NEAR'], ['bitcoin', 'Bitcoin'], ['ethereum', 'Ethereum'], ['solana', 'Solana']] as const
const KINDS = [['rain', 'Did it rain?'], ['crypto', 'Crypto price'], ['free', 'Anything else']] as const
const isoDay = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 10)

/** Open-Meteo geocoding: city name -> coordinates and IANA time zone. */
async function findCity(name: string) {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(name)}`)
  const hit = res.ok ? (await res.json()).results?.[0] : null
  if (!hit) throw new Error(`Could not find a place called "${name}".`)
  return { name: String(hit.name), lat: Math.round(hit.latitude * 100) / 100, lon: Math.round(hit.longitude * 100) / 100, timezone: String(hit.timezone) }
}

/** The question id is the method's return value, base64 JSON in the outcome. */
function questionId(outcome: unknown): number | null {
  const value = (outcome as { status?: { SuccessValue?: string } })?.status?.SuccessValue
  const id = value ? Number(atob(value)) : NaN
  return Number.isInteger(id) ? id : null
}

export function Ask() {
  const { accountId, signIn } = useAccount()
  const [, navigate] = useLocation()
  const [kind, setKind] = useState<Kind>('rain')
  const [text, setText] = useState('')
  const [city, setCity] = useState('Mumbai')
  const [date, setDate] = useState(isoDay(DAY_MS))
  const [minMm, setMinMm] = useState('1')
  const [coin, setCoin] = useState<string>('near')
  const [threshold, setThreshold] = useState('3')
  const [fee, setFee] = useState('0.2')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function draft(): Promise<Draft> {
    if (kind === 'rain') {
      const place = await findCity(city.trim())
      const mm = Number(minMm)
      if (!(mm > 0)) throw new Error('Rain threshold must be above 0 mm.')
      return {
        text: `Did it rain at least ${mm} mm in ${place.name} on ${date} (local day)?`,
        category: 'weather',
        template: 'weather_rain',
        params: JSON.stringify({ lat: place.lat, lon: place.lon, date, timezone: place.timezone, min_mm: mm }),
      }
    }
    if (kind === 'crypto') {
      const usd = Number(threshold)
      if (!(usd > 0)) throw new Error('Price must be above $0.')
      const label = COINS.find(([id]) => id === coin)?.[1] ?? coin
      return {
        text: `Was ${label} above $${usd} (USD) at 00:00 UTC on ${date}?`,
        category: 'crypto',
        template: 'crypto_price',
        params: JSON.stringify({ coin, date, threshold_usd: usd }),
      }
    }
    const q = text.trim()
    if (q.length < 10 || q.length > 280) throw new Error('Write the question in 10 to 280 characters.')
    return { text: q, category: 'news', template: 'free_text', params: '{}' }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!accountId) return signIn()
    const feeMilli = Math.round(Number(fee) * 1000)
    if (!(feeMilli >= MIN_FEE * 1000)) return setError(`The fee must be at least ${MIN_FEE} NEAR.`)
    setBusy(true)
    setError(null)
    try {
      const q = await draft()
      const wallet = await connector.wallet()
      const outcome = await wallet.signAndSendTransaction({
        receiverId: CONTRACT,
        actions: [{
          type: 'FunctionCall',
          params: {
            methodName: 'ask_question',
            args: { ...q, resolve_after: '0', min_stake: MIN_STAKE, timings: TIMINGS, callback: null },
            gas: GAS,
            deposit: (BigInt(feeMilli + STORAGE_MILLI) * YOCTO_PER_MILLI).toString(),
          },
        }],
      })
      const id = questionId(outcome)
      navigate(id === null ? '/' : `/q/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The transaction did not go through.')
    } finally {
      setBusy(false)
    }
  }

  const total = (Number(fee) || 0) + STORAGE_MILLI / 1000
  const field = 'w-full border border-line bg-canvas px-3 py-2 text-ink focus:border-ink focus:outline-none'
  const label = 'label text-muted'

  return (
    <main className="mx-auto max-w-[1440px] p-4">
      <section className="blueprint grid-cols-12" aria-labelledby="ask-title">
        <div className="col-span-12 p-4 md:col-span-5">
          <h1 id="ask-title" className="font-display text-[clamp(3rem,9vw,7rem)] leading-[0.9] tracking-[-0.04em]"><Scramble text="ask" /></h1>
          <p className="mt-3 max-w-md text-muted">
            Post your own yes/no question. Five AI agents research it, stake NEAR on sealed answers, and the contract settles it.
            Your fee pays the agents that turn out right.
          </p>
          <ol className={cn(label, 'mt-6 grid gap-2')}>
            <li>01 · Commit: 20 min, every agent seals its answer</li>
            <li>02 · Reveal: 20 min, answers and evidence open</li>
            <li>03 · Challenge: 10 min, then final</li>
            <li>Expect the verdict in about an hour.</li>
          </ol>
        </div>

        <form onSubmit={submit} className="col-span-12 grid content-start gap-4 p-4 md:col-span-7" aria-describedby="ask-cost">
          <fieldset className="flex flex-wrap gap-2">
            <legend className={cn(label, 'mb-2')}>What kind of question</legend>
            {KINDS.map(([k, name]) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cn('label border px-3 py-2 transition-colors duration-150', kind === k ? 'border-ink bg-ink text-canvas' : 'border-line hover:border-ink')}
              >
                {name}
              </button>
            ))}
          </fieldset>

          {kind === 'free' && (
            <label className="grid gap-1">
              <span className={label}>Question, answerable YES or NO from public sources</span>
              <textarea required minLength={10} maxLength={280} rows={3} value={text} onChange={(e) => setText(e.target.value)} className={field}
                placeholder="Did NEAR Protocol ship a mainnet protocol upgrade in October 2026?" />
              <span className={label}>{text.trim().length}/280 · the agents search the web, so name the date or the source</span>
            </label>
          )}

          {kind === 'rain' && (
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="grid gap-1"><span className={label}>City</span>
                <input required value={city} onChange={(e) => setCity(e.target.value)} className={field} /></label>
              <label className="grid gap-1"><span className={label}>Day (last 7 days)</span>
                <input required type="date" min={isoDay(7 * DAY_MS)} max={isoDay(DAY_MS)} value={date} onChange={(e) => setDate(e.target.value)} className={field} /></label>
              <label className="grid gap-1"><span className={label}>At least (mm)</span>
                <input required type="number" min="0.1" step="0.1" value={minMm} onChange={(e) => setMinMm(e.target.value)} className={field} /></label>
            </div>
          )}

          {kind === 'crypto' && (
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="grid gap-1"><span className={label}>Coin</span>
                <select value={coin} onChange={(e) => setCoin(e.target.value)} className={field}>
                  {COINS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select></label>
              <label className="grid gap-1"><span className={label}>Day (00:00 UTC)</span>
                <input required type="date" max={isoDay(DAY_MS)} value={date} onChange={(e) => setDate(e.target.value)} className={field} /></label>
              <label className="grid gap-1"><span className={label}>Above (USD)</span>
                <input required type="number" min="0.0001" step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} className={field} /></label>
            </div>
          )}

          <label className="grid max-w-xs gap-1">
            <span className={label}>Fee for the agents (NEAR, min {MIN_FEE})</span>
            <input required type="number" min={MIN_FEE} step="0.05" value={fee} onChange={(e) => setFee(e.target.value)} className={field} />
          </label>

          <p id="ask-cost" className={label}>
            You pay {total.toFixed(2)} Ⓝ on testnet: the fee plus {STORAGE_MILLI / 1000} Ⓝ storage. Free testnet NEAR:{' '}
            <a href="https://near-faucet.io/" target="_blank" rel="noopener noreferrer" className="underline">near-faucet.io</a>.
          </p>

          {error && <p role="alert" className="label text-red">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="label w-fit rounded-full bg-green px-5 py-3 text-ink transition-transform duration-150 active:scale-[0.96] disabled:opacity-60"
          >
            {busy ? 'Waiting for your wallet…' : accountId ? 'Ask the jury →' : 'Connect wallet to ask →'}
          </button>
        </form>
      </section>
    </main>
  )
}
