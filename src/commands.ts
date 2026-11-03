// The command union and its handlers. Every handler validates its own invariants and throws on a breach;
// the reducer copied the state first, so a throw changes nothing.

import { accountOf, building, business, currencyOf, finite, hasRightOfUse, lease, must, newId, nonempty, officeHas, parcel, pay, payLegs, post, project, record, title, titleOver, type Ctx, type PaymentLegs } from './context.ts'
import { moneyLedger } from './money-ledger.ts'
import { isPool } from './ids.ts'
import { contains, overlaps, union, type AssignmentKind, type Layout, type Placement, type ProductionLine, type ProjectKind, type ProjectPlan, type Rect, type Room, type Transferable } from './state.ts'
import { bandOf } from './config.ts'
import { availableOf } from './queries.ts'

export type Command =
  // land
  | { type: 'addDistrict'; name: string; kind: string; bounds: Rect }
  | { type: 'growDistrict'; district: string; bounds: Rect }
  | { type: 'addParcel'; district: string; footprint: Rect; access?: string[]; zoning?: string }
  | { type: 'splitParcel'; parcel: string; children: Rect[] }
  | { type: 'mergeParcels'; parcels: string[] }
  | { type: 'zone'; parcel: string; zoning: string }
  // property
  | { type: 'grantTitle'; subject: string; holder: string; class?: string; transferable?: Transferable; authority?: string | null }
  | { type: 'sell'; title: string; buyer: string; price: number; authority?: string | null }
  | { type: 'transfer'; title: string; to: string; kind: 'gift' | 'transfer' | 'seizure'; authority?: string | null; note?: string }
  | { type: 'inherit'; title: string; heir: string; note?: string }
  | { type: 'setTransferable'; title: string; transferable: Transferable }
  | { type: 'lease'; title: string; tenant: string; scope?: 'whole' | string[]; rent: number; end?: number | null; terms?: unknown }
  | { type: 'endLease'; lease: string }
  | { type: 'setRent'; lease: string; rent: number }
  // building
  | { type: 'addBuilding'; decayClass?: string; exposure?: string; parcel: string; footprint: Rect; storeys?: number; condition?: number; rooms?: Room[]; placements?: Placement[]; fixtures?: string[] }
  | { type: 'startProject'; kind: ProjectKind; target: string; plan?: ProjectPlan; materials?: { material: string; units: number }[]; labourHours?: number; pool?: string; wage?: number; account: string; inventory?: string; permitRequired?: boolean; permit?: string | null }
  | { type: 'advanceProject'; project: string; workerDays: number }
  | { type: 'cancelProject'; project: string }
  | { type: 'setLayout'; bldg: string; layout: Omit<Layout, 'version'>; by: string }
  | { type: 'addFixture'; bldg: string; fixture: string; by: string }
  | { type: 'removeFixture'; bldg: string; fixture: string; by: string }
  | { type: 'setDecayClass'; bldg: string; decayClass: string; exposure?: string }
  | { type: 'setCondition'; bldg: string; condition: number }
  // business
  | { type: 'openBusiness'; kind: string; premises: { bldg: string; rooms?: string[] }[]; operator: string; manager?: string | null; inventory: string; lines?: ProductionLine[]; publicWorks?: boolean }
  | { type: 'closeBusiness'; biz: string }
  | { type: 'setOperator'; biz: string; operator: string }
  | { type: 'setManager'; biz: string; manager: string | null }
  | { type: 'setInventory'; biz: string; inventory: string }
  | { type: 'setLines'; biz: string; lines: ProductionLine[] }
  | { type: 'setPublicWorks'; biz: string; publicWorks: boolean }
  | { type: 'addPost'; biz: string; role: string; requires?: unknown; wage: number; hours?: number; required?: boolean }
  | { type: 'removePost'; post: string }
  | { type: 'setWage'; post: string; wage: number }
  // people
  | { type: 'assign'; person: string; kind: AssignmentKind; target: string }
  | { type: 'unassign'; assignment: string }
  | { type: 'hire'; post: string; holder: string; cause?: string }
  | { type: 'dismiss'; post: string }
  // authority
  | { type: 'createOffice'; name: string; powers: string[]; seat?: string | null }
  | { type: 'appoint'; office: string; holder: string }
  | { type: 'vacate'; office: string }
  | { type: 'grantPermission'; office: string; kind: string; subject: string; expires?: number | null }
  | { type: 'revokePermission'; permission: string; office: string }
  // money
  | { type: 'hold'; account: string; amount: number; ref: string; currency?: string }
  | { type: 'release'; ref: string }
  | { type: 'settle'; ref: string; payee: string; amount?: number }
  | { type: 'credit'; holder: string; amount: number; note?: string; currency?: string; process?: string }
  | { type: 'debit'; holder: string; amount: number; note?: string; currency?: string; process?: string }
  | { type: 'pay'; from: string; to: string; amount: number; kind: string; subject?: string | null; note?: string;
      currency?: string; legs?: never; goods?: { from: string; to: string; good: string; units: number } }
  | { type: 'pay'; legs: PaymentLegs; kind: string; subject?: string | null; note?: string;
      from?: never; to?: never; amount?: never; currency?: never; goods?: never }
  // time
  | { type: 'tick' }

function rect(value: Rect, what: string): Rect {
  for (const key of ['x', 'y', 'w', 'h'] as const) finite(value?.[key], `${what}.${key}`)
  if (value.w <= 0 || value.h <= 0) throw new Error(`${what} must have positive size`)
  return { x: value.x, y: value.y, w: value.w, h: value.h }
}

// land

export function addDistrict(ctx: Ctx, c: Extract<Command, { type: 'addDistrict' }>): string {
  const id = newId(ctx, 'dist')
  ctx.state.districts[id] = { id, name: nonempty(c.name, 'name'), kind: nonempty(c.kind, 'kind'), bounds: rect(c.bounds, 'bounds') }
  ctx.state.settlement.districts.push(id)
  return id
}

export function growDistrict(ctx: Ctx, c: Extract<Command, { type: 'growDistrict' }>): void {
  const district = must(ctx.state.districts, c.district, 'district')
  const bounds = rect(c.bounds, 'bounds')
  if (!contains(bounds, district.bounds)) throw new Error('a district only grows: the new bounds must contain the old')
  district.bounds = bounds
}

export function addParcel(ctx: Ctx, c: Extract<Command, { type: 'addParcel' }>): string {
  const district = must(ctx.state.districts, c.district, 'district')
  const footprint = rect(c.footprint, 'footprint')
  if (!contains(district.bounds, footprint)) throw new Error('parcel outside its district')
  for (const other of Object.values(ctx.state.parcels)) {
    if (!other.retired && overlaps(other.footprint, footprint)) throw new Error(`parcel overlaps ${other.id}`)
  }
  const id = newId(ctx, 'parcel')
  ctx.state.parcels[id] = { id, district: district.id, footprint, access: [...(c.access ?? [])], zoning: c.zoning ?? 'any',
    buildings: [], vacant: true, splitFrom: null, mergedInto: null, retired: false }
  return id
}

export function splitParcel(ctx: Ctx, c: Extract<Command, { type: 'splitParcel' }>): string[] {
  const parent = parcel(ctx, c.parcel)
  if (parent.retired) throw new Error('parcel is retired')
  if (parent.buildings.length) throw new Error('split a parcel with buildings through a split project that assigns them')
  if (!Array.isArray(c.children) || c.children.length < 2) throw new Error('a split needs at least two children')
  const children = c.children.map((child, i) => rect(child, `children[${i}]`))
  children.forEach((child, i) => {
    if (!contains(parent.footprint, child)) throw new Error(`child ${i} outside the parent`)
    children.forEach((other, j) => { if (i < j && overlaps(child, other)) throw new Error(`children ${i} and ${j} overlap`) })
  })
  const ids = children.map((footprint) => {
    const id = newId(ctx, 'parcel')
    ctx.state.parcels[id] = { id, district: parent.district, footprint, access: [...parent.access], zoning: parent.zoning,
      buildings: [], vacant: true, splitFrom: parent.id, mergedInto: null, retired: false }
    return id
  })
  parent.retired = true
  // The parent's title, if any, is retired with it: the host grants titles over the children.
  const parentTitle = Object.values(ctx.state.titles).find((entry) => entry.subject === parent.id)
  if (parentTitle) {
    if (parentTitle.encumbrances.some((leaseId) => ctx.state.leases[leaseId]?.status === 'active')) throw new Error('parcel has active leases')
    const txn = record(ctx, 'transfer', parentTitle.holder, 'none', parentTitle.id, 0, null, `retired on split of ${parent.id}`)
    for (const id of ids) {
      const titleId = newId(ctx, 'title')
      ctx.state.titles[titleId] = { id: titleId, subject: id, holder: parentTitle.holder, class: parentTitle.class,
        encumbrances: [], since: txn, transferable: { ...parentTitle.transferable } }
    }
    parentTitle.holder = 'none'
    parentTitle.since = txn
  }
  ctx.events.push({ type: 'parcelSplit', parent: parent.id, children: ids })
  return ids
}

export function mergeParcels(ctx: Ctx, c: Extract<Command, { type: 'mergeParcels' }>): string {
  if (!Array.isArray(c.parcels) || c.parcels.length < 2) throw new Error('a merge needs at least two parcels')
  const parents = c.parcels.map((id) => parcel(ctx, id))
  if (parents.some((entry) => entry.retired)) throw new Error('a parcel is retired')
  if (new Set(parents.map((entry) => entry.district)).size !== 1) throw new Error('parcels must share a district')
  const holders = new Set(parents.map((entry) => titleOver(ctx, entry.id)?.holder ?? 'none'))
  if (holders.size !== 1) throw new Error('parcels must share a title holder to merge')
  const id = newId(ctx, 'parcel')
  ctx.state.parcels[id] = { id, district: parents[0].district, footprint: union(parents.map((entry) => entry.footprint)),
    access: [...new Set(parents.flatMap((entry) => entry.access))], zoning: parents[0].zoning,
    buildings: parents.flatMap((entry) => entry.buildings), vacant: parents.every((entry) => entry.vacant),
    splitFrom: null, mergedInto: null, retired: false }
  for (const entry of parents) { entry.retired = true; entry.mergedInto = id }
  for (const bldgId of ctx.state.parcels[id].buildings) ctx.state.buildings[bldgId].parcel = id
  const [holder] = holders
  const oldTitles = parents.map((entry) => titleOver(ctx, entry.id))
  if (holder !== 'none') {
    const txn = record(ctx, 'transfer', holder, holder, id, 0, null, `merge of ${c.parcels.join(', ')}`)
    const titleId = newId(ctx, 'title')
    ctx.state.titles[titleId] = { id: titleId, subject: id, holder, class: oldTitles[0]?.class ?? 'private', encumbrances: [],
      since: txn, transferable: { ...(oldTitles[0]?.transferable ?? { sale: true }) } }
    for (const old of oldTitles) if (old) { old.holder = 'none'; old.since = txn }
  }
  ctx.events.push({ type: 'parcelMerged', parcels: [...c.parcels], result: id })
  return id
}

export function zone(ctx: Ctx, c: Extract<Command, { type: 'zone' }>): void {
  parcel(ctx, c.parcel).zoning = nonempty(c.zoning, 'zoning')
}

// property

function subjectExists(ctx: Ctx, subject: string): void {
  if (!ctx.state.parcels[subject] && !ctx.state.buildings[subject]) throw new Error(`unknown subject: ${subject}`)
}

export function grantTitle(ctx: Ctx, c: Extract<Command, { type: 'grantTitle' }>): string {
  subjectExists(ctx, c.subject)
  const holder = nonempty(c.holder, 'holder')
  const existing = Object.values(ctx.state.titles).find((entry) => entry.subject === c.subject)
  if (existing && existing.holder !== 'none') throw new Error(`subject already titled: ${existing.id}`)
  // The first title over a subject is setup (the host says who holds what); re-granting a vacated one is an act of
  // authority and needs an office with the power.
  const authority = existing ? officeHas(ctx, c.authority, 'public-title', c.subject) : (c.authority ?? null)
  const id = existing?.id ?? newId(ctx, 'title')
  const txn = record(ctx, 'grant', existing?.holder ?? 'none', holder, id, 0, authority)
  if (existing) { existing.holder = holder; existing.since = txn; if (c.class) existing.class = c.class; return existing.id }
  ctx.state.titles[id] = { id, subject: c.subject, holder, class: c.class ?? (holder === 'town' ? 'public' : 'private'),
    encumbrances: [], since: txn, transferable: c.transferable ?? { sale: true } }
  return id
}

function changeHolder(ctx: Ctx, titleId: string, to: string, txn: string): void {
  const entry = title(ctx, titleId)
  const from = entry.holder
  entry.holder = to
  entry.since = txn
  ctx.events.push({ type: 'titleChanged', title: entry.id, subject: entry.subject, from, to, txn })
}

export function sell(ctx: Ctx, c: Extract<Command, { type: 'sell' }>): string {
  const entry = title(ctx, c.title)
  const buyer = nonempty(c.buyer, 'buyer')
  if (entry.holder === 'none') throw new Error('nobody holds this title; grant it')
  if (entry.holder === buyer) throw new Error('buyer already holds the title')
  if (!entry.transferable.sale) throw new Error('title is not for sale')
  if (entry.transferable.to && !entry.transferable.to.includes(buyer)) throw new Error(`title may not pass to ${buyer}`)
  const txn = pay(ctx, buyer, entry.holder, finite(c.price, 'price', 0), 'sale', entry.id, c.authority ?? null)
  changeHolder(ctx, entry.id, buyer, txn)
  return txn
}

export function transfer(ctx: Ctx, c: Extract<Command, { type: 'transfer' }>): string {
  const entry = title(ctx, c.title)
  const to = nonempty(c.to, 'to')
  if (entry.holder === to) throw new Error('already the holder')
  let authority: string | null = c.authority ?? null
  if (c.kind === 'seizure') authority = officeHas(ctx, c.authority, 'seize', entry.subject)
  else if (entry.transferable.to && !entry.transferable.to.includes(to)) throw new Error(`title may not pass to ${to}`)
  const txn = record(ctx, c.kind, entry.holder, to, entry.id, 0, authority, c.note ?? '')
  changeHolder(ctx, entry.id, to, txn)
  return txn
}

/** The heir is named by the host; the engine has no law of succession. */
export function inherit(ctx: Ctx, c: Extract<Command, { type: 'inherit' }>): string {
  const entry = title(ctx, c.title)
  const heir = nonempty(c.heir, 'heir')
  const txn = record(ctx, 'inherit', entry.holder, heir, entry.id, 0, null, c.note ?? '')
  changeHolder(ctx, entry.id, heir, txn)
  return txn
}

export function setTransferable(ctx: Ctx, c: Extract<Command, { type: 'setTransferable' }>): void {
  title(ctx, c.title).transferable = { sale: !!c.transferable.sale, ...(c.transferable.to ? { to: [...c.transferable.to] } : {}) }
}

export function leaseTitle(ctx: Ctx, c: Extract<Command, { type: 'lease' }>): string {
  const entry = title(ctx, c.title)
  if (entry.holder === 'none') throw new Error('nobody holds this title')
  const tenant = nonempty(c.tenant, 'tenant')
  const scope = c.scope ?? 'whole'
  const active = entry.encumbrances.map((id) => ctx.state.leases[id]).filter((item) => item.status === 'active')
  if (scope === 'whole' && active.length) throw new Error('title already leased')
  if (scope !== 'whole') {
    const bldg = ctx.state.buildings[entry.subject]
    if (!bldg) throw new Error('rooms can only be leased on a building title')
    for (const room of scope) {
      if (!bldg.layout.rooms.some((item) => item.id === room)) throw new Error(`unknown room: ${room}`)
      if (active.some((item) => item.scope === 'whole' || item.scope.includes(room))) throw new Error(`room already leased: ${room}`)
    }
  }
  const id = newId(ctx, 'lease')
  const day = ctx.state.settlement.day
  if (c.end != null && finite(c.end, 'end') <= day) throw new Error('lease ends before it starts')
  ctx.state.leases[id] = { id, title: entry.id, tenant, scope: scope === 'whole' ? 'whole' : [...scope], rent: finite(c.rent, 'rent', 0),
    start: day, end: c.end ?? null, terms: c.terms ?? null, status: 'active' }
  entry.encumbrances.push(id)
  record(ctx, 'lease', entry.holder, tenant, id, 0, null)
  ctx.events.push({ type: 'leaseChanged', lease: id, title: entry.id, tenant, status: 'active' })
  return id
}

export function endLease(ctx: Ctx, c: Extract<Command, { type: 'endLease' }>): void {
  const entry = lease(ctx, c.lease)
  if (entry.status === 'ended') return
  entry.status = 'ended'
  entry.end = ctx.state.settlement.day
  record(ctx, 'lease-end', title(ctx, entry.title).holder, entry.tenant, entry.id, 0, null)
  ctx.events.push({ type: 'leaseChanged', lease: entry.id, title: entry.title, tenant: entry.tenant, status: 'ended' })
}

export function setRent(ctx: Ctx, c: Extract<Command, { type: 'setRent' }>): void {
  lease(ctx, c.lease).rent = finite(c.rent, 'rent', 0)
}

// building

/** Seed a building that already stands (the town as it is when you arrive). New buildings come from projects. */
function checkDecay(ctx: Ctx, data: { decayClass?: string; exposure?: string }): void {
  if (data.decayClass !== undefined && !Object.hasOwn(ctx.config.decayClasses, data.decayClass)) throw new Error(`unknown decay class: ${data.decayClass}`)
  if (data.exposure !== undefined && !Object.hasOwn(ctx.config.exposure, data.exposure)) throw new Error(`unknown exposure: ${data.exposure}`)
}

/** Host classification; omitting exposure preserves the building's current exposure. */
export function setDecayClass(ctx: Ctx, c: Extract<Command, { type: 'setDecayClass' }>): void {
  const bldg = building(ctx, c.bldg)
  checkDecay(ctx, c)
  bldg.decayClass = c.decayClass
  if (c.exposure !== undefined) bldg.exposure = c.exposure
}

export function addBuilding(ctx: Ctx, c: Extract<Command, { type: 'addBuilding' }>): string {
  checkDecay(ctx, c)
  const site = parcel(ctx, c.parcel)
  if (site.retired) throw new Error('parcel is retired')
  const footprint = rect(c.footprint, 'footprint')
  if (!contains(site.footprint, footprint)) throw new Error('footprint outside the parcel')
  const fixtures = [...(c.fixtures ?? [])]
  const rooms = structuredClone(c.rooms ?? [])
  const placements = structuredClone(c.placements ?? [])
  checkPlacements(rooms, placements, fixtures)
  const condition = finite(c.condition ?? 1, 'condition', 0)
  if (condition > 1) throw new Error('condition is 0..1')
  const id = newId(ctx, 'bldg')
  ctx.state.buildings[id] = { id, parcel: site.id, footprint, storeys: c.storeys ?? 1, condition,
    decayClass: c.decayClass, exposure: c.exposure,
    layout: { version: 1, rooms, placements }, layoutHistory: [], fixtures, builtOn: ctx.state.settlement.day, demolishedOn: null }
  site.buildings.push(id)
  site.vacant = false
  return id
}

export function startProject(ctx: Ctx, c: Extract<Command, { type: 'startProject' }>): string {
  const plan = c.plan ?? {}
  const isParcel = !!ctx.state.parcels[c.target]
  const isBuilding = !!ctx.state.buildings[c.target]
  if (!isParcel && !isBuilding) throw new Error(`unknown target: ${c.target}`)
  switch (c.kind) {
    case 'construct':
      checkDecay(ctx, plan)
      if (!isParcel) throw new Error('construct targets a parcel')
      if (parcel(ctx, c.target).retired) throw new Error('parcel is retired')
      rect(plan.footprint ?? (() => { throw new Error('construct needs a footprint') })(), 'plan.footprint')
      if (!contains(parcel(ctx, c.target).footprint, plan.footprint!)) throw new Error('footprint outside the parcel')
      break
    case 'renovate': case 'repair': case 'demolish':
      if (!isBuilding) throw new Error(`${c.kind} targets a building`)
      if (building(ctx, c.target).demolishedOn !== null) throw new Error('building is demolished')
      break
    case 'split': case 'merge': case 'public-work':
      if (!isParcel) throw new Error(`${c.kind} targets a parcel`)
      break
    default: throw new Error(`unknown project kind: ${String(c.kind)}`)
  }
  if (c.permitRequired && c.permit) {
    const permit = must(ctx.state.permissions, c.permit, 'permission')
    if (permit.status !== 'active' || permit.subject !== c.target) throw new Error('permit does not cover the target')
  }
  const id = newId(ctx, 'proj')
  ctx.state.projects[id] = { id, kind: c.kind, target: c.target, plan: structuredClone(plan),
    materials: (c.materials ?? []).map((item) => ({ material: nonempty(item.material, 'material'), units: finite(item.units, 'units', 0) })),
    labourHours: finite(c.labourHours ?? 0, 'labourHours', 0), pool: c.pool ?? 'pool.default', wage: finite(c.wage ?? 0, 'wage', 0),
    account: nonempty(c.account, 'account'), inventory: nonempty(c.inventory ?? c.account, 'inventory'), permitRequired: !!c.permitRequired, permit: c.permit ?? null,
    materialsDrawn: (c.materials ?? []).length === 0, progress: 0, status: 'active', result: null }
  return id
}

export function cancelProject(ctx: Ctx, c: Extract<Command, { type: 'cancelProject' }>): void {
  const entry = project(ctx, c.project)
  if (entry.status !== 'active') throw new Error('project is not active')
  entry.status = 'cancelled'
}

function nextLayout(bldg: { layout: Layout; layoutHistory: Layout[] }, rooms: Room[], placements: Placement[]): void {
  bldg.layoutHistory.push(structuredClone(bldg.layout))
  bldg.layout = { version: bldg.layout.version + 1, rooms: structuredClone(rooms), placements: structuredClone(placements) }
}

function checkPlacements(rooms: Room[], placements: Placement[], fixtures: string[]): void {
  for (const placement of placements) {
    if (!rooms.some((room) => room.id === placement.room)) throw new Error(`placement in unknown room: ${placement.room}`)
    if (!fixtures.includes(placement.fixture)) throw new Error(`placement of a fixture the building lacks: ${placement.fixture}`)
  }
}

/** Apply a completed project's plan. Called by the tick (or by advanceProject) when progress reaches labourHours. */
export function completeProject(ctx: Ctx, id: string): void {
  const entry = project(ctx, id)
  if (entry.status !== 'active') return
  if (entry.permitRequired && !entry.permit) throw new Error('project needs a permit before completion')
  const day = ctx.state.settlement.day
  const plan = entry.plan
  switch (entry.kind) {
    case 'construct': {
      const site = parcel(ctx, entry.target)
      const bldgId = newId(ctx, 'bldg')
      const fixtures = [...(plan.addFixtures ?? [])]
      const rooms = plan.rooms ?? []
      checkPlacements(rooms, plan.placements ?? [], fixtures)
      ctx.state.buildings[bldgId] = { id: bldgId, parcel: site.id, footprint: plan.footprint!, storeys: plan.storeys ?? 1,
        decayClass: plan.decayClass, exposure: plan.exposure,
        condition: plan.condition ?? 1, layout: { version: 1, rooms: structuredClone(rooms), placements: structuredClone(plan.placements ?? []) },
        layoutHistory: [], fixtures, builtOn: day, demolishedOn: null }
      site.buildings.push(bldgId)
      site.vacant = false
      entry.result = bldgId
      break
    }
    case 'renovate': {
      const bldg = building(ctx, entry.target)
      const fixtures = [...bldg.fixtures.filter((item) => !(plan.removeFixtures ?? []).includes(item)), ...(plan.addFixtures ?? [])]
      const rooms = [...bldg.layout.rooms, ...(plan.rooms ?? []).filter((room) => !bldg.layout.rooms.some((item) => item.id === room.id))]
      const kept = bldg.layout.placements.filter((item) => fixtures.includes(item.fixture)
        && !(plan.placements ?? []).some((next) => next.fixture === item.fixture))
      const placements = [...kept, ...(plan.placements ?? [])]
      checkPlacements(rooms, placements, fixtures)
      bldg.fixtures = fixtures
      if (plan.storeys) bldg.storeys = plan.storeys
      if (plan.condition != null) bldg.condition = plan.condition
      nextLayout(bldg, rooms, placements)
      ctx.events.push({ type: 'fixtureChanged', bldg: bldg.id, fixtures: [...fixtures] })
      break
    }
    case 'repair': {
      const bldg = building(ctx, entry.target)
      bldg.condition = Math.max(bldg.condition, plan.condition ?? 1)
      break
    }
    case 'demolish': {
      const bldg = building(ctx, entry.target)
      bldg.demolishedOn = day
      const site = parcel(ctx, bldg.parcel)
      site.buildings = site.buildings.filter((item) => item !== bldg.id)
      site.vacant = site.buildings.length === 0
      for (const biz of Object.values(ctx.state.businesses)) {
        if (biz.open && biz.premises.some((item) => item.bldg === bldg.id)) biz.open = false
      }
      break
    }
    case 'split': {
      const ids = splitParcel(ctx, { type: 'splitParcel', parcel: entry.target, children: plan.children ?? [] })
      entry.result = ids.join(',')
      break
    }
    case 'merge': {
      entry.result = mergeParcels(ctx, { type: 'mergeParcels', parcels: plan.parcels ?? [] })
      break
    }
    case 'public-work': break
  }
  entry.status = 'done'
  ctx.events.push({ type: 'projectCompleted', project: entry.id, kind: entry.kind, target: entry.target, result: entry.result })
}

/** The host pushes worker-days directly (a story crew builds it); wages are paid as in the tick. */
export function advanceProject(ctx: Ctx, c: Extract<Command, { type: 'advanceProject' }>): void {
  const entry = project(ctx, c.project)
  if (entry.status !== 'active') throw new Error('project is not active')
  if (!entry.materialsDrawn) throw new Error('materials not yet drawn: tick first, or supply them')
  const days = finite(c.workerDays, 'workerDays', 0)
  if (entry.wage > 0 && days > 0) pay(ctx, entry.account, entry.pool, entry.wage * days, 'wage', entry.id)
  entry.progress += days * ctx.config.hoursPerDay
  if (entry.progress >= entry.labourHours) completeProject(ctx, entry.id)
}

function layoutAuthority(ctx: Ctx, bldgId: string, by: string): void {
  if (!ctx.config.freeLayout) throw new Error('layouts change only through a renovate project (config.freeLayout is off)')
  if (!hasRightOfUse(ctx, by, bldgId)) throw new Error(`${by} has no right of use over ${bldgId}`)
}

export function setLayout(ctx: Ctx, c: Extract<Command, { type: 'setLayout' }>): void {
  const bldg = building(ctx, c.bldg)
  layoutAuthority(ctx, bldg.id, c.by)
  checkPlacements(c.layout.rooms, c.layout.placements, bldg.fixtures)
  nextLayout(bldg, c.layout.rooms, c.layout.placements)
}

export function addFixture(ctx: Ctx, c: Extract<Command, { type: 'addFixture' }>): void {
  const bldg = building(ctx, c.bldg)
  layoutAuthority(ctx, bldg.id, c.by)
  bldg.fixtures.push(nonempty(c.fixture, 'fixture'))
  ctx.events.push({ type: 'fixtureChanged', bldg: bldg.id, fixtures: [...bldg.fixtures] })
}

export function removeFixture(ctx: Ctx, c: Extract<Command, { type: 'removeFixture' }>): void {
  const bldg = building(ctx, c.bldg)
  layoutAuthority(ctx, bldg.id, c.by)
  const at = bldg.fixtures.indexOf(c.fixture)
  if (at < 0) throw new Error(`building lacks ${c.fixture}`)
  bldg.fixtures.splice(at, 1)
  bldg.layout.placements = bldg.layout.placements.filter((item) => item.fixture !== c.fixture || bldg.fixtures.includes(c.fixture))
  ctx.events.push({ type: 'fixtureChanged', bldg: bldg.id, fixtures: [...bldg.fixtures] })
}

export function setCondition(ctx: Ctx, c: Extract<Command, { type: 'setCondition' }>): void {
  const value = finite(c.condition, 'condition', 0)
  if (value > 1) throw new Error('condition is 0..1')
  building(ctx, c.bldg).condition = value
  bandOf(ctx.config, value)
}

// business

export function openBusiness(ctx: Ctx, c: Extract<Command, { type: 'openBusiness' }>): string {
  const operator = nonempty(c.operator, 'operator')
  if (!Array.isArray(c.premises) || !c.premises.length) throw new Error('a business needs premises')
  const premises = c.premises.map((item) => {
    const bldg = building(ctx, item.bldg)
    if (bldg.demolishedOn !== null) throw new Error('premises demolished')
    if (!hasRightOfUse(ctx, operator, bldg.id)) throw new Error(`${operator} has no right of use over ${bldg.id} (no title, no lease)`)
    for (const room of item.rooms ?? []) if (!bldg.layout.rooms.some((entry) => entry.id === room)) throw new Error(`unknown room: ${room}`)
    return { bldg: bldg.id, rooms: [...(item.rooms ?? [])] }
  })
  const id = newId(ctx, 'biz')
  ctx.state.businesses[id] = { id, kind: nonempty(c.kind, 'kind'), premises, operator, manager: c.manager ?? null, posts: [],
    lines: structuredClone(c.lines ?? []), inventory: nonempty(c.inventory, 'inventory'), account: accountOf(ctx, id).id,
    status: 'dormant', publicWorks: !!c.publicWorks, open: true }
  return id
}

export function closeBusiness(ctx: Ctx, c: Extract<Command, { type: 'closeBusiness' }>): void {
  const biz = business(ctx, c.biz)
  biz.open = false
  setStatus(ctx, biz.id, 'dormant')
}

export function setStatus(ctx: Ctx, bizId: string, status: 'dormant' | 'staffed' | 'producing'): void {
  const biz = business(ctx, bizId)
  if (biz.status === status) return
  ctx.events.push({ type: 'businessStatusChanged', biz: biz.id, from: biz.status, to: status })
  biz.status = status
}

export function setOperator(ctx: Ctx, c: Extract<Command, { type: 'setOperator' }>): void {
  const biz = business(ctx, c.biz)
  const operator = nonempty(c.operator, 'operator')
  for (const item of biz.premises) if (!hasRightOfUse(ctx, operator, item.bldg)) throw new Error(`${operator} has no right of use over ${item.bldg}`)
  const from = biz.operator
  biz.operator = operator
  ctx.events.push({ type: 'operatorChanged', biz: biz.id, from, to: operator })
}

export function setManager(ctx: Ctx, c: Extract<Command, { type: 'setManager' }>): void {
  const biz = business(ctx, c.biz)
  const from = biz.manager
  biz.manager = c.manager ?? null
  ctx.events.push({ type: 'managerChanged', biz: biz.id, from, to: biz.manager })
}

export function setLines(ctx: Ctx, c: Extract<Command, { type: 'setLines' }>): void {
  business(ctx, c.biz).lines = c.lines.map((line) => ({ recipe: nonempty(line.recipe, 'recipe'), equipment: [...line.equipment] }))
}

export function setPublicWorks(ctx: Ctx, c: Extract<Command, { type: 'setPublicWorks' }>): void {
  business(ctx, c.biz).publicWorks = !!c.publicWorks
}

export function addPost(ctx: Ctx, c: Extract<Command, { type: 'addPost' }>): string {
  const biz = business(ctx, c.biz)
  const id = newId(ctx, 'post')
  ctx.state.posts[id] = { id, biz: biz.id, role: nonempty(c.role, 'role'), requires: c.requires ?? null, wage: finite(c.wage, 'wage', 0),
    hours: finite(c.hours ?? ctx.config.hoursPerDay, 'hours', 0), required: c.required ?? true, holder: null, filledBy: null }
  biz.posts.push(id)
  return id
}

/** A post's wage, per day, from the next wages step (CONTRACTS.md s5): the host's number, or a market quote the host chose to pass on. */
export function setWage(ctx: Ctx, c: Extract<Command, { type: 'setWage' }>): void {
  post(ctx, c.post).wage = finite(c.wage, 'wage', 0)
}

export function removePost(ctx: Ctx, c: Extract<Command, { type: 'removePost' }>): void {
  const entry = post(ctx, c.post)
  const biz = business(ctx, entry.biz)
  biz.posts = biz.posts.filter((item) => item !== entry.id)
  for (const asg of Object.values(ctx.state.assignments)) if (asg.target === entry.id && asg.until === null) asg.until = ctx.state.settlement.day
  delete ctx.state.posts[entry.id]
}

// people

export function assign(ctx: Ctx, c: Extract<Command, { type: 'assign' }>): string {
  const person = nonempty(c.person, 'person')
  if (!['residence', 'employment', 'management', 'membership'].includes(c.kind)) throw new Error(`unknown assignment kind: ${String(c.kind)}`)
  const target = nonempty(c.target, 'target')
  if (c.kind === 'residence' && !ctx.state.buildings[target]) throw new Error('residence targets a building')
  if (c.kind === 'employment' && !ctx.state.posts[target]) throw new Error('employment targets a post')
  if (c.kind === 'management' && !ctx.state.businesses[target]) throw new Error('management targets a business')
  const dup = Object.values(ctx.state.assignments).find((asg) => asg.person === person && asg.kind === c.kind && asg.target === target && asg.until === null)
  if (dup) return dup.id
  const id = newId(ctx, 'asg')
  ctx.state.assignments[id] = { id, person, kind: c.kind, target, since: ctx.state.settlement.day, until: null }
  if (c.kind === 'employment') { const entry = post(ctx, target); if (entry.holder !== person) entry.holder = person }
  if (c.kind === 'management') { const biz = business(ctx, target); if (biz.manager !== person) setManager(ctx, { type: 'setManager', biz: biz.id, manager: person }) }
  return id
}

export function unassign(ctx: Ctx, c: Extract<Command, { type: 'unassign' }>): void {
  const asg = must(ctx.state.assignments, c.assignment, 'assignment')
  if (asg.until !== null) return
  asg.until = ctx.state.settlement.day
  if (asg.kind === 'employment') { const entry = ctx.state.posts[asg.target]; if (entry && entry.holder === asg.person) { entry.holder = null; entry.filledBy = null } }
  if (asg.kind === 'management') { const biz = ctx.state.businesses[asg.target]; if (biz && biz.manager === asg.person) setManager(ctx, { type: 'setManager', biz: biz.id, manager: null }) }
}

export function hire(ctx: Ctx, c: Extract<Command, { type: 'hire' }>): void {
  const entry = post(ctx, c.post)
  const holder = nonempty(c.holder, 'holder')
  if (entry.holder && entry.holder !== holder) dismiss(ctx, { type: 'dismiss', post: entry.id })
  entry.holder = holder
  if (!isPool(holder)) assign(ctx, { type: 'assign', person: holder, kind: 'employment', target: entry.id })
  const filled = { type: 'postFilled' as const, post: entry.id, holder, wage: entry.wage, ...(c.cause ? { cause: c.cause } : {}) }
  ctx.events.push(filled)
  if (c.cause) ctx.events.push({ type: 'shared.action.outcome', cause: c.cause, status: 'completed',
    stimuli: [{ post: entry.id, holder, wage: entry.wage }], payload: filled })
}

export function dismiss(ctx: Ctx, c: Extract<Command, { type: 'dismiss' }>): void {
  const entry = post(ctx, c.post)
  if (!entry.holder) return
  const holder = entry.holder
  entry.holder = null
  entry.filledBy = null
  for (const asg of Object.values(ctx.state.assignments)) {
    if (asg.kind === 'employment' && asg.target === entry.id && asg.person === holder && asg.until === null) asg.until = ctx.state.settlement.day
  }
}

// authority

export function createOffice(ctx: Ctx, c: Extract<Command, { type: 'createOffice' }>): string {
  if (c.seat) building(ctx, c.seat)
  const id = newId(ctx, 'office')
  ctx.state.offices[id] = { id, name: nonempty(c.name, 'name'), holder: null, powers: [...c.powers], seat: c.seat ?? null }
  return id
}

export function appoint(ctx: Ctx, c: Extract<Command, { type: 'appoint' }>): void {
  const office = must(ctx.state.offices, c.office, 'office')
  office.holder = nonempty(c.holder, 'holder')
  record(ctx, 'appoint', null, office.holder, office.id, 0, office.id)
  ctx.events.push({ type: 'officeChanged', office: office.id, holder: office.holder })
}

export function vacate(ctx: Ctx, c: Extract<Command, { type: 'vacate' }>): void {
  const office = must(ctx.state.offices, c.office, 'office')
  record(ctx, 'vacate', office.holder, null, office.id, 0, office.id)
  office.holder = null
  ctx.events.push({ type: 'officeChanged', office: office.id, holder: null })
}

export function grantPermission(ctx: Ctx, c: Extract<Command, { type: 'grantPermission' }>): string {
  const office = officeHas(ctx, c.office, 'permit', c.subject)
  subjectExists(ctx, c.subject)
  const id = newId(ctx, 'perm')
  const txn = record(ctx, 'permit', office, c.subject, id, 0, office, c.kind)
  ctx.state.permissions[id] = { id, kind: nonempty(c.kind, 'kind'), subject: c.subject, grantedBy: office, txn, expires: c.expires ?? null, status: 'active' }
  for (const entry of Object.values(ctx.state.projects)) {
    if (entry.status === 'active' && entry.permitRequired && !entry.permit && entry.target === c.subject) entry.permit = id
  }
  ctx.events.push({ type: 'permissionChanged', permission: id, status: 'active' })
  return id
}

export function revokePermission(ctx: Ctx, c: Extract<Command, { type: 'revokePermission' }>): void {
  const subject = ctx.state.permissions[c.permission]?.subject ?? null
  const office = officeHas(ctx, c.office, 'permit', subject)
  const entry = must(ctx.state.permissions, c.permission, 'permission')
  entry.status = 'revoked'
  record(ctx, 'revoke', office, entry.subject, entry.id, 0, office)
  ctx.events.push({ type: 'permissionChanged', permission: entry.id, status: 'revoked' })
}

// money

export function hold(ctx: Ctx, c: Extract<Command, { type: 'hold' }>): void {
  const ref = nonempty(c.ref, 'ref')
  if (Object.hasOwn(ctx.state.holds ?? {}, ref)) throw new Error(`hold: duplicate ref ${ref}`)
  const account = nonempty(c.account, 'account')
  const amount = finite(c.amount, 'amount', 0)
  const currency = currencyOf(ctx, c.currency)
  const available = availableOf(ctx.state, account, currency)
  if (amount > available) throw new Error(`hold: ${amount} exceeds available ${available} on ${account}`)
  ctx.state.holds = { ...ctx.state.holds, [ref]: { ref, account, amount, currency, status: 'active', settled: 0 } }
}

function activeHold(ctx: Ctx, ref: string) {
  nonempty(ref, 'ref')
  if (!Object.hasOwn(ctx.state.holds ?? {}, ref)) throw new Error(`unknown hold: ${ref}`)
  const entry = ctx.state.holds![ref]
  if (entry.status !== 'active') throw new Error(`hold ${ref} is ${entry.status}`)
  return entry
}

export function release(ctx: Ctx, c: Extract<Command, { type: 'release' }>): void {
  activeHold(ctx, c.ref).status = 'released'
}

export function settle(ctx: Ctx, c: Extract<Command, { type: 'settle' }>): string {
  const entry = activeHold(ctx, c.ref)
  const remainder = entry.amount - entry.settled
  const amount = finite(c.amount ?? remainder, 'amount', 0)
  if (amount > remainder) throw new Error(`settle: ${amount} exceeds remainder ${remainder} on ${c.ref}`)
  const txn = pay(ctx, entry.account, nonempty(c.payee, 'payee'), amount, 'transfer', entry.ref, null, '', undefined, entry.currency)
  entry.settled = amount === remainder ? entry.amount : entry.settled + amount
  if (amount === remainder) entry.status = 'settled'
  return txn
}

export function credit(ctx: Ctx, c: Extract<Command, { type: 'credit' }>): void {
  const currency = currencyOf(ctx, c.currency)
  if (currency !== 'money' && !c.process) throw new Error('credit: a process is required')
  accountOf(ctx, nonempty(c.holder, 'holder'))
  moneyLedger(ctx).apply(c.holder, currency, finite(c.amount, 'amount', 0))
  record(ctx, 'credit', null, c.holder, null, c.amount, null, c.note ?? '', currency, c.process)
}

export function debit(ctx: Ctx, c: Extract<Command, { type: 'debit' }>): void {
  const currency = currencyOf(ctx, c.currency)
  if (currency !== 'money' && !c.process) throw new Error('debit: a process is required')
  accountOf(ctx, nonempty(c.holder, 'holder'))
  moneyLedger(ctx).apply(c.holder, currency, -finite(c.amount, 'amount', 0))
  record(ctx, 'debit', c.holder, null, null, c.amount, null, c.note ?? '', currency, c.process)
}

/** Move money between holders under the caller's kind (CONTRACTS.md s3, s13e): the economy's LedgerProvider.transfer. Returns the row id. */
export function payCommand(ctx: Ctx, c: Extract<Command, { type: 'pay' }>): string | string[] {
  if (c.legs !== undefined) {
    if (['from', 'to', 'amount', 'currency', 'goods'].some(key => Object.hasOwn(c, key))) {
      throw new Error('pay: legs cannot be combined with single-payment fields')
    }
    return payLegs(ctx, c.legs, c.kind, c.subject ?? null, c.note ?? '', ctx.opts?.goods)
  }
  if (ctx.opts?.goods && !c.goods) throw new Error('pay: a goods ledger was passed without goods data')
  if (c.goods) {
    nonempty(c.goods.from, 'goods.from')
    nonempty(c.goods.to, 'goods.to')
    nonempty(c.goods.good, 'goods.good')
    finite(c.goods.units, 'units', 0)
  }
  const goods = c.goods && ctx.opts?.goods ? { ledger: ctx.opts.goods, ...c.goods } : undefined
  return pay(ctx, nonempty(c.from, 'from'), nonempty(c.to, 'to'), finite(c.amount, 'amount', 0), nonempty(c.kind, 'kind'), c.subject ?? null, null, c.note ?? '', goods, c.currency)
}

export function setInventory(ctx: Ctx, c: Extract<Command, { type: 'setInventory' }>): void {
  const biz = business(ctx, c.biz)
  biz.inventory = nonempty(c.inventory, 'inventory')
}
