// Pure reads over a state (PACKAGES.md s3).
import { bandOf, type SettlementConfig } from './config.ts'
import type { Assignment, Business, DayProduction, Lease, Rect, SettlementState, Title, Transaction } from './state.ts'

export function titleOver(state: SettlementState, subject: string): Title | null {
  const direct = Object.values(state.titles).find((entry) => entry.subject === subject && entry.holder !== 'none')
  if (direct) return direct
  const bldg = state.buildings[subject]
  if (bldg) return Object.values(state.titles).find((entry) => entry.subject === bldg.parcel && entry.holder !== 'none') ?? null
  return null
}

export const holderOf = (state: SettlementState, subject: string): string => titleOver(state, subject)?.holder ?? 'none'

export const titlesOf = (state: SettlementState, holder: string): Title[] =>
  Object.values(state.titles).filter((entry) => entry.holder === holder)

export const tenantsOf = (state: SettlementState, titleId: string): Lease[] =>
  Object.values(state.leases).filter((entry) => entry.title === titleId && entry.status === 'active')

export const assignmentsOf = (state: SettlementState, person: string, active = true): Assignment[] =>
  Object.values(state.assignments).filter((entry) => entry.person === person && (!active || entry.until === null))

export const whereLives = (state: SettlementState, person: string): string[] =>
  assignmentsOf(state, person).filter((entry) => entry.kind === 'residence').map((entry) => entry.target)

export const whereWorks = (state: SettlementState, person: string): string[] =>
  assignmentsOf(state, person).filter((entry) => entry.kind === 'employment').map((entry) => state.posts[entry.target]?.biz).filter((id): id is string => !!id)

export const businessesIn = (state: SettlementState, bldg: string): Business[] =>
  Object.values(state.businesses).filter((entry) => entry.premises.some((item) => item.bldg === bldg))

/** Does a building, or the whole settlement, hold a fixture; with activeOnly, only counted in a non-dormant business. */
export function hasFixture(state: SettlementState, where: string | null, fixture: string, options: { activeOnly?: boolean } = {}): boolean {
  const buildings = Object.values(state.buildings).filter((bldg) => bldg.demolishedOn === null && (where === null || bldg.id === where))
  return buildings.some((bldg) => bldg.fixtures.includes(fixture)
    && (!options.activeOnly || businessesIn(state, bldg.id).some((biz) => biz.status !== 'dormant')))
}

export const physical = (state: SettlementState, bldg: string, config: SettlementConfig): string =>
  bandOf(config, state.buildings[bldg].condition).name

export const economic = (state: SettlementState, biz: string): string => state.businesses[biz].status

export const production = (state: SettlementState, biz: string): DayProduction | null => state.production[biz] ?? null

export type LedgerFilter = Partial<Pick<Transaction, 'kind' | 'subject' | 'from' | 'to'>> & { holder?: string; fromDay?: number; toDay?: number }

/** Ledger rows matching every given field; `holder` matches either side; `fromDay`..`toDay` inclusive (CONTRACTS.md s3). */
export const ledger = (state: SettlementState, filter: LedgerFilter = {}): Transaction[] => {
  const { holder, fromDay, toDay, ...fields } = filter
  return state.ledger.filter((row) => Object.entries(fields).every(([key, value]) => row[key as keyof typeof fields] === value)
    && (holder === undefined || row.from === holder || row.to === holder)
    && (fromDay === undefined || row.day >= fromDay) && (toDay === undefined || row.day <= toDay))
}

export const balanceOf = (state: SettlementState, holder: string): number =>
  Object.values(state.accounts).find((account) => account.holder === holder)?.balance ?? 0

export const totalMoney = (state: SettlementState): number =>
  Object.values(state.accounts).reduce((sum, account) => sum + account.balance, 0)

export function mapLayer(state: SettlementState): { districts: { id: string; kind: string; bounds: Rect }[]; parcels: { id: string; district: string; footprint: Rect; vacant: boolean }[] } {
  return {
    districts: Object.values(state.districts).map((entry) => ({ id: entry.id, kind: entry.kind, bounds: entry.bounds })),
    parcels: Object.values(state.parcels).filter((entry) => !entry.retired).map((entry) => ({ id: entry.id, district: entry.district, footprint: entry.footprint, vacant: entry.vacant })),
  }
}

/** Standing buildings whose decay lacks evidence; repair and ruined condition are not evidence gaps. */
export function unvalidatedDecay(state: SettlementState, config: SettlementConfig): { bldg: string; reason: 'no class' | 'null class' | 'null exposure' }[] {
  return Object.values(state.buildings).filter((bldg) => bldg.demolishedOn === null).flatMap((bldg) => {
    const reason = bldg.decayClass === undefined ? 'no class'
      : config.decayClasses[bldg.decayClass]?.yearsToRuin == null ? 'null class'
      : config.exposure[bldg.exposure ?? 'sheltered'] == null ? 'null exposure' : null
    return reason === null ? [] : [{ bldg: bldg.id, reason }]
  })
}
