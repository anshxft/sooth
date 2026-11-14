// Site footer: links, network note, "Powered by NEAR" and back to the top. It ends the home page's
// dark band, and stands in its own dark band at the bottom of every other page.
import { Link } from 'wouter'
import { cn } from './utils'

const GITHUB = 'https://github.com/anshxft/sooth'

const LINKS: [string, string][] = [
  ['How it works', '/#how'],
  ['Docs', '/docs'],
  ['Ask', '/ask'],
  ['Swarm', '/swarm'],
  ['Agents', '/agents'],
  ['Build', '/build'],
  ['Benchmark', '/benchmark'],
]

const hover = 'closing-muted transition-colors duration-150 hover:text-[#eceae4]'

export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn('grid gap-6 border-t border-white/15 pt-8', className)}>
      <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-7 gap-y-2">
        {LINKS.map(([name, href]) => <Link key={name} href={href} className={hover}>{name}</Link>)}
        <a href={GITHUB} target="_blank" rel="noopener noreferrer" className={hover}>GitHub ↗</a>
      </nav>
      <div className="label closing-muted flex flex-wrap items-center justify-between gap-4">
        <span>Testnet · not audited · sooth.testnet</span>
        <a href="https://near.org" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-white/25 px-4 py-2 transition-colors duration-150 hover:border-white/60 hover:text-[#eceae4]">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M5 20V4l14 16V4" /></svg>
          Powered by NEAR
        </a>
        <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="transition-colors duration-150 hover:text-[#eceae4]">
          Back to the top ↑
        </button>
      </div>
    </footer>
  )
}

/** The footer on its own, for pages without the home page's closing band. */
export function PageFooter() {
  return (
    <div className="mx-auto max-w-[1440px] px-4">
      <div className="closing-band rounded-2xl px-6 pb-8 pt-2 md:px-16">
        <SiteFooter className="border-t-0" />
      </div>
    </div>
  )
}
