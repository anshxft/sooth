import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// cn() helper expected by Magic UI / shadcn-style components
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
