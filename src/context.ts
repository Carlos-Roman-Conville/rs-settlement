// The working context of one reduce call: a deep copy of the state (so a throw leaves the caller's state
// untouched), the config, the providers and the events collected so far. Helpers every command and tick step share.

import { finite, must, nonempty } from '@rex/kernel'
import type { SettlementConfig } from './config.ts'
import type { SettlementEvent } from './events.ts'
import { mint, type Prefix } from './ids.ts'
import { officePowersAuthority, type Providers } from './providers.ts'
import { titleOver as queryTitleOver } from './queries.ts'
import type { Account, Building, Business, Lease, Parcel, Post, Project, SettlementState, Title, TransactionKind } from './state.ts'

export interface Ctx {
  state: SettlementState
  config: SettlementConfig
  providers: Providers
  events: SettlementEvent[]
  /** The day's staffing outcome (business ids); tick context only, never saved in the state. */
  staffed: Set<string>
}

export function newId(ctx: Ctx, prefix: Prefix): string {
  const minted = mint(ctx.state.counters, prefix)
  ctx.state.counters = minted.counters
  return minted.id
}

export { must, nonempty, finite }

export const parcel = (ctx: Ctx, id: string): Parcel => must(ctx.state.parcels, id, 'parcel')
export const building = (ctx: Ctx, id: string): Building => must(ctx.state.buildings, id, 'building')
export const title = (ctx: Ctx, id: string): Title => must(ctx.state.titles, id, 'title')
export const lease = (ctx: Ctx, id: string): Lease => must(ctx.state.leases, id, 'lease')
export const business = (ctx: Ctx, id: string): Business => must(ctx.state.businesses, id, 'business')
export const post = (ctx: Ctx, id: string): Post => must(ctx.state.posts, id, 'post')
export const project = (ctx: Ctx, id: string): Project => must(ctx.state.projects, id, 'project')

/** The account of a holder, created with a zero balance when first needed (deterministic on replay). */
export function accountOf(ctx: Ctx, holder: string): Account {
  const found = Object.values(ctx.state.accounts).find((account) => account.holder === holder)
  if (found) return found
  const id = newId(ctx, 'acct')
  const account: Account = { id, holder, balance: 0 }
  ctx.state.accounts[id] = account
  return account
}

export function record(ctx: Ctx, kind: TransactionKind, from: string | null, to: string | null, subject: string | null,
  amount: number, authority: string | null, note = ''): string {
  const id = newId(ctx, 'txn')
  ctx.state.ledger.push({ id, day: ctx.state.settlement.day, kind, from, to, subject, amount, authority, note })
  return id
}

/** Move money between holders and write the ledger row. Balances may go negative (debt); the total is conserved. */
export function pay(ctx: Ctx, from: string, to: string, amount: number, kind: TransactionKind, subject: string | null,
  authority: string | null = null, note = ''): string {
  finite(amount, 'amount', 0)
  const payer = accountOf(ctx, from)
  const payee = accountOf(ctx, to)
  payer.balance -= amount
  payee.balance += amount
  return record(ctx, kind, from, to, subject, amount, authority, note)
}

/** The held title over a subject (a building, else its parcel), or null. */
export function titleOver(ctx: Ctx, subject: string): Title | null {
  return queryTitleOver(ctx.state, subject)
}

/** Who may use a building: its title holder, or a tenant with an active lease on that title. */
export function hasRightOfUse(ctx: Ctx, who: string, bldg: string): boolean {
  const owner = titleOver(ctx, bldg)
  if (!owner) return false
  if (owner.holder === who) return true
  return Object.values(ctx.state.leases).some((entry) => entry.title === owner.id && entry.tenant === who && entry.status === 'active')
}

export function officeHas(ctx: Ctx, office: string | null | undefined, power: string, subject: string | null = null): string {
  if (!office) throw new Error(`an office with the power '${power}' is required`)
  const found = must(ctx.state.offices, office, 'office')
  if (!found.holder) throw new Error(`office is vacant: ${office}`)
  if (!(ctx.providers.authority ?? officePowersAuthority(ctx.state)).may(office, power, subject, ctx.state.settlement.day)) {
    throw new Error(`office ${office} lacks the power '${power}'`)
  }
  return office
}
