import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// cn() helper expected by Magic UI / shadcn-style components
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

/** 'BidCommit' -> 'Bid commit', 'AwaitingTally' -> 'Awaiting tally' (contract enum names shown as labels). */
export const spaced = (name: string) => name.replace(/([a-z])([A-Z])/g, (_, a: string, b: string) => `${a} ${b.toLowerCase()}`)
