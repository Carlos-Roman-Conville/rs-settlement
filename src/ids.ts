// Ids: a prefix and a zero-padded counter per settlement state, minted by the reducer so a replay mints the
// same ids. Ids are never reused and never renamed; a retired record keeps its id.

import { mint as kernelMint, type Counters } from '@rex/kernel'

export const PREFIXES = [
  'dist', 'parcel', 'bldg', 'title', 'lease', 'txn', 'acct', 'biz', 'post', 'asg', 'proj', 'office', 'perm',
] as const
export type Prefix = typeof PREFIXES[number]

export type { Counters } from '@rex/kernel'

/** The kernel's mint, typed so callers still pass a settlement `Prefix`. */
export const mint: (counters: Counters, prefix: Prefix) => { id: string; counters: Counters } = kernelMint

export function prefixOf(id: string): string {
  return id.slice(0, id.indexOf('.'))
}

/** Pool ids are the host's: anything starting with `pool.` is a draw from an unnamed labour pool. */
export function isPool(person: string): boolean {
  return person.startsWith('pool.')
}
