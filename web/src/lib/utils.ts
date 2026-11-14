import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// cn() helper expected by Magic UI / shadcn-style components
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

/** 'BidCommit' -> 'Bid commit', 'AwaitingTally' -> 'Awaiting tally' (contract enum names shown as labels). */
export const spaced = (name: string) => name.replace(/([a-z])([A-Z])/g, (_, a: string, b: string) => `${a} ${b.toLowerCase()}`)

const LONG_ACCOUNT = 20 // characters; named accounts like alice.testnet stay whole

/** Implicit (64-hex) and 0x accounts as 69d039…cb3a; short named accounts unchanged. */
export const shortAccount = (id: string) => (id.length > LONG_ACCOUNT && !id.includes('.') ? `${id.slice(0, 6)}…${id.slice(-4)}` : id)
