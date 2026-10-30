// The records (PACKAGES.md s2). Plain JSON, versioned, no game meaning. "Opaque" strings are stored and
// compared, never interpreted: person ids, fixture ids, role ids, recipe ids, kinds.

import type { Counters } from './ids.ts'

export interface Rect { x: number; y: number; w: number; h: number }

export interface Settlement {
  id: string
  name: string
  day: number
  treasury: string          // an account id; money is conserved across accounts
  districts: string[]
}

export interface District {
  id: string
  name: string
  kind: string              // opaque: harbour, square, housing, farmland, edge ...
  bounds: Rect
}

export interface Parcel {
  id: string
  district: string
  footprint: Rect
  access: string[]          // opaque: road, harbour, path ...
  zoning: string            // opaque
  buildings: string[]
  vacant: boolean
  splitFrom: string | null
  mergedInto: string | null
  retired: boolean
}

export interface Room { id: string; name: string; tiles: Rect; use: string }
export interface Placement { fixture: string; room: string; at: { x: number; y: number } }
export interface Layout { version: number; rooms: Room[]; placements: Placement[] }

export interface Building {
  id: string
  parcel: string
  footprint: Rect
  storeys: number
  condition: number         // 0..1; bands are config data
  layout: Layout
  layoutHistory: Layout[]   // earlier versions, oldest first
  fixtures: string[]        // opaque equipment ids (the pirate game's 25 facility ids live here)
  builtOn: number
  demolishedOn: number | null
}

export interface Transferable { sale: boolean; to?: string[] }   // not every property is purchasable (Rex, via paste)

export interface Title {
  id: string
  subject: string           // a parcel or building id
  holder: string            // opaque: a person, 'player', 'town', 'none'
  class: string             // opaque: private / player / public / vacant (proposed)
  encumbrances: string[]    // lease ids
  since: string | null      // the transaction that made the current holder
  transferable: Transferable
}

export interface Lease {
  id: string
  title: string
  tenant: string            // opaque
  scope: 'whole' | string[] // whole, or room ids
  rent: number              // per day
  start: number
  end: number | null
  terms: unknown
  status: 'active' | 'ended'
}

/** The kinds the engine writes. Any string is a kind (CONTRACTS.md s3): the economy writes its own through `pay`. */
export const SETTLEMENT_KINDS = [
  'sale', 'lease', 'lease-end', 'inherit', 'transfer', 'seizure', 'gift', 'grant', 'permit',
  'wage', 'rent', 'purchase', 'credit', 'debit', 'appoint', 'vacate', 'revoke',
] as const
export type SettlementKind = typeof SETTLEMENT_KINDS[number]
export type TransactionKind = string

export interface Transaction {
  id: string
  day: number
  kind: TransactionKind
  from: string | null
  to: string | null
  subject: string | null
  amount: number
  authority: string | null  // an office id
  note: string
}

export interface Account { id: string; holder: string; balance: number }

export interface ProductionLine {
  recipe: string            // opaque; its rates come from MaterialProvider.rates each tick (CONTRACTS.md s13a)
  equipment: string[]       // fixture ids the line needs (any count; more fixtures, more output)
}

export type BusinessStatus = 'dormant' | 'staffed' | 'producing'

export interface Business {
  id: string
  kind: string              // opaque
  premises: { bldg: string; rooms: string[] }[]
  operator: string          // who runs it
  manager: string | null    // who directs it day to day
  posts: string[]
  lines: ProductionLine[]
  inventory: string         // an opaque inventory ref the MaterialProvider understands
  account: string
  status: BusinessStatus
  publicWorks: boolean
  open: boolean
}

export interface Post {
  id: string
  biz: string
  role: string              // opaque occupation id
  requires: unknown         // evaluated by the LabourProvider
  wage: number              // per day
  hours: number             // per day
  required: boolean         // the business is dormant while a required post is unfilled
  holder: string | null     // a person id or a pool id
  filledBy: string | null   // today's resolution (null when the holder was unavailable)
}

export type AssignmentKind = 'residence' | 'employment' | 'management' | 'membership'

export interface Assignment {
  id: string
  person: string
  kind: AssignmentKind
  target: string            // a building, post, business, or an opaque crew id
  since: number
  until: number | null
}

export interface ProjectPlan {
  footprint?: Rect
  storeys?: number
  rooms?: Room[]            // rooms added (renovate) or the whole set (construct)
  placements?: Placement[]
  addFixtures?: string[]
  removeFixtures?: string[]
  condition?: number        // repair sets condition to this
  children?: Rect[]         // split
  parcels?: string[]        // merge
}

export type ProjectKind = 'construct' | 'renovate' | 'repair' | 'demolish' | 'split' | 'merge' | 'public-work'

export interface Project {
  id: string
  kind: ProjectKind
  target: string            // a parcel or building id
  plan: ProjectPlan
  materials: { material: string; units: number }[]
  labourDays: number
  pool: string              // where labour is drawn from
  wage: number              // per worker-day
  account: string           // who pays (a holder id)
  inventory: string         // where the materials are drawn from (an opaque inventory ref, CONTRACTS.md s2); DUP-44
  permitRequired: boolean
  permit: string | null     // a permission id
  materialsDrawn: boolean
  progress: number          // worker-days done
  status: 'active' | 'done' | 'cancelled'
  result: string | null     // a minted building or parcel id, on completion
}

export interface Office {
  id: string
  name: string              // opaque: mayor, council ...
  holder: string | null
  powers: string[]          // opaque: permit, public-title, tax, seize ...
  seat: string | null       // a building id
}

export interface Permission {
  id: string
  kind: string
  subject: string
  grantedBy: string         // office id
  txn: string
  expires: number | null
  status: 'active' | 'expired' | 'revoked'
}

export interface DayProduction { day: number; lines: { recipe: string; q: number; caps: Record<string, number> }[] }

export interface SettlementState {
  version: 1
  settlement: Settlement
  counters: Counters
  districts: Record<string, District>
  parcels: Record<string, Parcel>
  buildings: Record<string, Building>
  titles: Record<string, Title>
  leases: Record<string, Lease>
  ledger: Transaction[]
  accounts: Record<string, Account>
  businesses: Record<string, Business>
  posts: Record<string, Post>
  assignments: Record<string, Assignment>
  projects: Record<string, Project>
  offices: Record<string, Office>
  permissions: Record<string, Permission>
  production: Record<string, DayProduction>
  tickTrace: string[]       // the tick steps of the last day, in order
}

export function initialState(id: string, name: string): SettlementState {
  return {
    version: 1,
    settlement: { id, name, day: 0, treasury: 'acct.0001', districts: [] },
    counters: { acct: 1 },
    districts: {}, parcels: {}, buildings: {}, titles: {}, leases: {}, ledger: [],
    accounts: { 'acct.0001': { id: 'acct.0001', holder: 'town', balance: 0 } },
    businesses: {}, posts: {}, assignments: {}, projects: {}, offices: {}, permissions: {},
    production: {}, tickTrace: [],
  }
}

export function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function union(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h))
  return { x, y, w: x1 - x, h: y1 - y }
}
