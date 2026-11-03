// Provider interfaces (PACKAGES.md s4): what the engine asks of the host. The engine imports no other engine;
// the host implements these from @rex/economy, @rex/realism, its population model, or the stubs below.

import type { SettlementState } from './state.ts'

export interface LabourRow { category: string; persons: number; personHours: number }

export interface LabourSupply {
  /** The population's supply today by category (adult men, adult women, elders, children: Reality's
   *  categories); persons = cohort × health × (1 − sick share), health applied once; personHours = persons ×
   *  the host's hours per day (one number, Settlement's `hoursPerDay`, SET-12). */
  supply(day: number): LabourRow[]
  /** False while a person is aboard, dead or away: the host knows, the engines do not. */
  available(person: string, day: number): boolean
  /** Person-hours a person or a pool offers for a role today. */
  hours(source: string, role: string, day: number): number
  /** Person-hours a pool grants a post today: at most `wantedHours` and at most what it has not granted yet. */
  draw(pool: string, role: string, requires: unknown, wantedHours: number, day: number): number
  /** 0..n output factor of a holder in a role; the host maps skill bands to it. */
  productivity(holder: string, role: string): number
}

export interface MaterialProvider {
  /** Output units the inputs on hand in `inventory` allow for `recipe`. */
  available(inventory: string, recipe: string): number
  /** Consume the inputs and add the outputs for `units` of `recipe`. */
  produce(inventory: string, recipe: string, units: number): void
  /** Units of a material on hand in `inventory`. */
  have(inventory: string, material: string): number
  /** Take up to `units` of a material for a project; returns what was taken. */
  take(inventory: string, material: string, units: number): number
  /** A recipe's rates (CONTRACTS.md s13a): the recipe's home is the economy, so the engine reads them each tick. */
  rates(recipe: string): Rates
}

export interface Rates {
  unitsPerFixtureDay: number   // output units one fixture of each needed kind allows per day
  labourHoursPerUnit: number  // person-hours per unit; 0 means the line needs no labour
}

export interface UtilityProvider {
  capacity(building: string, recipe: string, state: SettlementState): number
}

export interface PriceProvider {
  valueOf(subject: string, day: number): number
}

export type AuthorityAnswer = { kind: 'yes' } | { kind: 'no'; reason: string } | { kind: 'unknown'; reads: string[] }

export interface AuthorityProvider {
  /** Pure (CONTRACTS §17): may this office exercise this power over this subject on this day?
   *  GOVERNMENT-SETTLEMENT.md §2. */
  may(office: string, power: string, subject: string | null, day: number): AuthorityAnswer
}

export function officePowersAuthority(state: SettlementState): AuthorityProvider {
  return { may: (office, power) => state.offices[office]?.powers.includes(power)
    ? { kind: 'yes' } : { kind: 'no', reason: 'lacks power' } }
}

export interface CurrencyProvider { isCurrency(id: string): boolean }

export interface Providers {
  labour: LabourSupply
  materials: MaterialProvider
  utilities: UtilityProvider
  prices: PriceProvider
  authority?: AuthorityProvider
  currencies?: CurrencyProvider
}

// In-memory stubs for tests and examples.

export interface StubRecipe extends Rates { inputs: { good: string; units: number }[]; output: string; yield: number }

export class StubMaterials implements MaterialProvider {
  stock: Record<string, Record<string, number>> = {}
  recipes: Record<string, StubRecipe>
  constructor(recipes: Record<string, StubRecipe> = {}) { this.recipes = recipes }
  set(inventory: string, good: string, units: number): void {
    (this.stock[inventory] ??= {})[good] = units
  }
  get(inventory: string, good: string): number {
    return this.stock[inventory]?.[good] ?? 0
  }
  available(inventory: string, recipe: string): number {
    const def = this.recipes[recipe]
    if (!def) throw new Error(`stub recipe unknown: ${recipe}`)
    if (!def.inputs.length) return Number.POSITIVE_INFINITY
    return Math.floor(Math.min(...def.inputs.map((input) => this.get(inventory, input.good) / input.units)))
  }
  produce(inventory: string, recipe: string, units: number): void {
    const def = this.recipes[recipe]
    if (!def) throw new Error(`stub recipe unknown: ${recipe}`)
    for (const input of def.inputs) this.set(inventory, input.good, this.get(inventory, input.good) - input.units * units)
    this.set(inventory, def.output, this.get(inventory, def.output) + def.yield * units)
  }
  rates(recipe: string): Rates {
    const def = this.recipes[recipe]
    if (!def) throw new Error(`stub recipe unknown: ${recipe}`)
    return { unitsPerFixtureDay: def.unitsPerFixtureDay, labourHoursPerUnit: def.labourHoursPerUnit }
  }
  have(inventory: string, material: string): number { return this.get(inventory, material) }
  take(inventory: string, material: string, units: number): number {
    const have = this.get(inventory, material)
    const taken = Math.min(have, units)
    this.set(inventory, material, have - taken)
    return taken
  }
}

export class StubLabourSupply implements LabourSupply {
  away = new Set<string>()
  pools: Record<string, number> = {} // workers per pool per day
  factors: Record<string, number> = {}
  grants: { day: number; pool: string; role: string; hours: number }[] = []
  hoursPerDay: number
  constructor(hoursPerDay = 10) { this.hoursPerDay = hoursPerDay }
  supply(_day: number): LabourRow[] {
    return Object.keys(this.pools).sort().map((pool) => ({
      category: pool, persons: this.pools[pool], personHours: this.pools[pool] * this.hoursPerDay,
    }))
  }
  available(person: string): boolean { return !this.away.has(person) }
  hours(source: string, _role: string, day: number): number {
    if (!this.available(source)) return 0
    // Named people have no finite schedule in this stub; hosts can supply one through hours().
    if (!Object.hasOwn(this.pools, source)) return source.startsWith('pool.') ? 0 : Infinity
    const granted = this.grants.filter((row) => row.day === day && row.pool === source)
      .reduce((sum, row) => sum + row.hours, 0)
    return Math.max(0, this.pools[source] * this.hoursPerDay - granted)
  }
  draw(pool: string, role: string, _requires: unknown, wantedHours: number, day: number): number {
    const hours = Object.hasOwn(this.pools, pool) ? Math.max(0, Math.min(wantedHours, this.hours(pool, role, day))) : 0
    if (hours > 0) this.grants.push({ day, pool, role, hours })
    return hours
  }
  productivity(holder: string): number { return this.factors[holder] ?? 1 }
}

/** @deprecated Use StubLabourSupply; retained for the economy adapter's fixtures. */
export { StubLabourSupply as StubLabour }

export class StubUtilities implements UtilityProvider {
  caps: Record<string, number> = {}
  fallback: number
  constructor(fallback = Number.POSITIVE_INFINITY) { this.fallback = fallback }
  capacity(building: string): number { return this.caps[building] ?? this.fallback }
}

export class StubPrices implements PriceProvider {
  values: Record<string, number> = {}
  valueOf(subject: string): number { return this.values[subject] ?? 0 }
}

export function stubProviders(recipes: Record<string, StubRecipe> = {}): Providers & {
  labour: StubLabourSupply; materials: StubMaterials; utilities: StubUtilities; prices: StubPrices
} {
  return { labour: new StubLabourSupply(), materials: new StubMaterials(recipes), utilities: new StubUtilities(), prices: new StubPrices() }
}
