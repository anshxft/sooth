// "Check it yourself": the exact read-only CLI calls that return what a page shows, with copy
// buttons, plus explorer links. Nothing on this site has to be taken on trust.
import { useState } from 'react'

export type Check = { label: string; command: string }
type Props = { checks: Check[]; links: { label: string; href: string }[] }

export function VerifyPanel({ checks, links }: Props) {
  return (
    <section className="col-span-12 p-6 md:p-8" aria-labelledby="verify-title">
      <span className="label text-muted">Don't trust this page</span>
      <h2 id="verify-title" className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Check it yourself on NEAR</h2>
      <p className="mt-2 max-w-2xl text-muted">
        Every number here comes from the contracts. These read-only calls return the same data, free, with{' '}
        <a href="https://github.com/near/near-cli-rs" target="_blank" rel="noopener noreferrer" className="underline">near-cli-rs</a>.
      </p>
      <ul className="mt-5 grid min-w-0 gap-3">
        {checks.map((c) => <Command key={c.label} {...c} />)}
      </ul>
      <p className="label mt-5 flex flex-wrap gap-x-5 gap-y-2">
        {links.map((l) => (
          <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="hover:underline">{l.label} ↗</a>
        ))}
      </p>
    </section>
  )
}

function Command({ label, command }: Check) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setState('copied')
    } catch {
      setState('failed') // clipboard blocked: the text is still selectable
    }
    setTimeout(() => setState('idle'), 1600)
  }
  return (
    <li className="min-w-0 border border-line">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <span className="label text-muted">{label}</span>
        <button type="button" onClick={copy} className="label border border-ink px-2 py-1 transition-colors duration-150 hover:bg-ink hover:text-canvas">
          {state === 'copied' ? 'Copied ✓' : state === 'failed' ? 'Select & copy' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-5 select-all"><code>{command}</code></pre>
    </li>
  )
}

const call = (contract: string, method: string, args: object) =>
  `near contract call-function as-read-only ${contract} ${method} json-args '${JSON.stringify(args)}' network-config testnet now`

export const cli = { call }
