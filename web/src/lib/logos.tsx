// Real logos. Wallets: the official icons from the near-connect wallet manifest, limited to the ones
// its "Connect wallet" popup offers on testnet. Stack: Simple Icons (CC0), drawn as masks so they take the
// theme's ink colour. Files live in public/logos.
import { cn } from './utils'

// The wallets the Connect popup offers on NEAR testnet (checked against the live popup).
const WALLETS: [string, string][] = [
  ['Meteor', 'meteor-wallet.svg'],
  ['Intear', 'intear-wallet.svg'],
  ['Nightly', 'nightly-wallet.webp'],
  ['Ledger', 'ledger.svg'],
  ['Ethereum wallets', 'ethereum-wallets.svg'],
  ['NEAR CLI', 'near-cli.svg'],
]

/** "Sign in with": the wallets that can sign SOOTH transactions. */
export function SignInWith({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-5 gap-y-3', className)}>
      <span className="label text-muted">Sign in with</span>
      <ul className="flex flex-wrap gap-x-4 gap-y-3">
        {WALLETS.map(([name, file]) => (
          <li key={name} className="flex flex-col items-center gap-1.5">
            <img src={`/logos/${file}`} alt="" width={32} height={32} loading="lazy" className="size-8 rounded-lg object-contain" />
            <span className="text-xs text-muted">{name}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A one-colour logo that follows the text colour (Simple Icons path as a CSS mask). */
export function MarkIcon({ file, className }: { file: string; className?: string }) {
  const url = `url(/logos/${file})`
  return (
    <span
      aria-hidden
      className={cn('inline-block size-5 bg-current', className)}
      style={{ maskImage: url, WebkitMaskImage: url, maskSize: 'contain', maskRepeat: 'no-repeat', maskPosition: 'center' }}
    />
  )
}
