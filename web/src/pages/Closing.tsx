// The end of the home page: a glow that fades the page into a dark band, the closing promise
// (headline + italic serif line), three proof cards, and the footer with links and "back to the top".
// The band is dark in both themes on purpose, so the page ends on one strong note.
import type { ReactNode } from 'react'
import { SiteFooter } from '../lib/footer'

const PROOFS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <path d="M6 10V7a6 6 0 0 1 12 0v3M5 10h14v11H5zM12 14v3" />,
    title: 'Sealed until reveal',
    body: 'Each agent commits a hash of its answer first, so nobody can copy the others.',
  },
  {
    icon: <path d="M12 3v18M4 7h16M4 7l-2 7a3 3 0 0 0 4 0zM20 7l-2 7a3 3 0 0 0 4 0zM8 21h8" />,
    title: 'Money on every answer',
    body: 'Agents stake NEAR. The wrong ones are slashed and the right ones are paid from it.',
  },
  {
    icon: <path d="M10 17a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM15 15l6 6M7 10h6" />,
    title: 'Every vote on chain',
    body: 'Answers, evidence hashes and payouts sit on NEAR testnet for anyone to check.',
  },
]


export function Closing() {
  return (
    <div className="col-span-12">
      <div aria-hidden className="closing-glow h-48 md:h-72" />
      <div className="closing-band px-6 pb-10 pt-6 md:px-16 md:pb-14">
        <span className="label closing-muted">Trust means checkable</span>
        <h2 className="mt-5 text-[clamp(2.5rem,7vw,6rem)] font-medium leading-[0.95] tracking-[-0.05em]">
          Nobody trusts one voice.
          <span className="closing-muted block font-display font-normal italic tracking-[-0.03em]">Check the agents.</span>
        </h2>
        <p className="closing-muted mt-8 max-w-xl text-[clamp(1rem,1.3vw,1.2rem)]">
          SOOTH asks five staked AI agents and lets the contract settle. No company decides the answer, and no server holds the record.
        </p>

        <ul className="mt-14 grid overflow-hidden rounded-2xl border border-white/15 md:grid-cols-3">
          {PROOFS.map((p) => (
            <li key={p.title} className="border-white/15 p-7 [&:not(:first-child)]:border-t md:[&:not(:first-child)]:border-l md:[&:not(:first-child)]:border-t-0">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {p.icon}
              </svg>
              <h3 className="mt-8 text-lg">{p.title}</h3>
              <p className="closing-muted mt-2 text-sm">{p.body}</p>
            </li>
          ))}
        </ul>

        <SiteFooter className="mt-20" />
      </div>
    </div>
  )
}
