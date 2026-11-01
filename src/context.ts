// The working context of one reduce call: a deep copy of the state (so a throw leaves the caller's state
// untouched), the config, the providers and the events collected so far. Helpers every command and tick step share.

import { finite, must, nonempty, transfer, TransferJournal } from '@rex/kernel'
import type { TransferLedger, TransferRequest } from '@rex/kernel'
import type { SettlementConfig } from './config.ts'
import type { SettlementEvent } from './events.ts'
import { mint, type Prefix } from './ids.ts'
import { moneyLedger } from './money-ledger.ts'
import { officePowersAuthority, type Providers } from './providers.ts'
import { titleOver as queryTitleOver } from './queries.ts'
import type { ReduceOpts } from './reduce.ts'
import type { Account, Building, Business, Lease, Parcel, Post, Project, SettlementState, Title, TransactionKind } from './state.ts'

export interface Ctx {
  state: SettlementState
  config: SettlementConfig
  providers: Providers
  opts?: ReduceOpts
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

export function currencyOf(ctx: Ctx, id?: string): string {
  if (id === undefined || id === 'money') return 'money'
  if (ctx.providers.currencies?.isCurrency(id)) return id
  throw new Error(`unknown currency: ${id}`)
}

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
  amount: number, authority: string | null, note = '', currency = 'money', process?: string): string {
  const id = newId(ctx, 'txn')
  ctx.state.ledger.push({ id, day: ctx.state.settlement.day, kind, from, to, subject, amount, authority, note,
    ...(currency === 'money' ? {} : { currency }), ...(process === undefined ? {} : { process }) })
  return id
}

/** Move money between holders and write the ledger row. Balances may go negative (debt); the total is conserved. */
export function pay(ctx: Ctx, from: string, to: string, amount: number, kind: TransactionKind, subject: string | null,
  authority: string | null = null, note = '',
  goods?: { ledger: TransferLedger; from: string; to: string; good: string; units: number }, currency = 'money'): string {
  currency = currencyOf(ctx, currency)
  finite(amount, 'amount', 0)
  accountOf(ctx, from)
  accountOf(ctx, to)
  const requests: TransferRequest[] = []
  const t = ctx.state.settlement.day * 86_400_000
  // Zero amounts and self-payments leave balances unchanged; the kernel refuses both.
  if (amount > 0 && from !== to) {
    const ledger = moneyLedger(ctx)
    requests.push({
      t, process: 'settlement.ledger.pay',
      quantity: currency, unit: 'money', amount,
      from: { ledger, account: from }, to: { ledger, account: to }, note: kind,
    })
  }
  if (goods && finite(goods.units, 'units', 0) > 0) {
    requests.push({
      t, process: 'economy.trade.trade', quantity: goods.good,
      unit: goods.ledger.unit(goods.from, goods.good), amount: goods.units,
      from: { ledger: goods.ledger, account: goods.from },
      to: { ledger: goods.ledger, account: goods.to }, note: kind,
    })
  }
  if (requests.length) transfer(new TransferJournal('settlement.money'), ...requests)
  return record(ctx, kind, from, to, subject, amount, authority, note, currency)
}

export interface PaymentLegs {
  money: { from: string; to: string; currency: string; amount: number }[]
  goods?: { from: string; to: string; good: string; units: number }[]
}

/** Validate the entire exchange before moving either ledger; replay needs only its money legs. */
export function payLegs(ctx: Ctx, legs: PaymentLegs, kind: TransactionKind, subject: string | null,
  note = '', goodsLedger?: TransferLedger): string[] {
  nonempty(kind, 'kind')
  if (goodsLedger && !legs.goods?.length) throw new Error('pay: a goods ledger was passed without goods data')
  for (const leg of legs.money) {
    currencyOf(ctx, nonempty(leg.currency, 'currency'))
    accountOf(ctx, nonempty(leg.from, 'from'))
    accountOf(ctx, nonempty(leg.to, 'to'))
    finite(leg.amount, 'amount', 0)
  }
  for (const leg of legs.goods ?? []) {
    nonempty(leg.from, 'goods.from')
    nonempty(leg.to, 'goods.to')
    nonempty(leg.good, 'goods.good')
    finite(leg.units, 'units', 0)
  }
  const requests: TransferRequest[] = []
  const t = ctx.state.settlement.day * 86_400_000
  const ledger = moneyLedger(ctx)
  for (const leg of legs.money) {
    if (leg.amount === 0 || leg.from === leg.to) continue
    requests.push({ t, process: 'settlement.ledger.pay', quantity: leg.currency, unit: 'money',
      amount: leg.amount, from: { ledger, account: leg.from }, to: { ledger, account: leg.to }, note: kind })
  }
  if (goodsLedger) for (const leg of legs.goods ?? []) {
    if (leg.units === 0) continue
    requests.push({ t, process: 'economy.trade.trade', quantity: leg.good, unit: goodsLedger.unit(leg.from, leg.good),
      amount: leg.units, from: { ledger: goodsLedger, account: leg.from }, to: { ledger: goodsLedger, account: leg.to }, note: kind })
  }
  if (requests.length) transfer(new TransferJournal('settlement.money'), ...requests)
  const ids: string[] = []
  for (const leg of legs.money) {
    ids.push(record(ctx, kind, leg.from, leg.to, subject, leg.amount, null, note, leg.currency))
    ctx.state.ledger[ctx.state.ledger.length - 1].batch = ids[0]
  }
  return ids
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
