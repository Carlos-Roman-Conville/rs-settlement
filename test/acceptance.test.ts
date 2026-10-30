// The engine half of TESTS.md A1: buy a property, transfer its title, lease it to a business, staff it, renovate
// its interior, produce goods; the ledger is complete and money is conserved. The story-and-alignment half runs
// in the pirate adapter (web/src/settlement/), where the alignment engine lives.
import { describe, expect, it } from 'vitest'
import { Runner } from '../src/reduce.ts'
import { initialState } from '../src/state.ts'
import { defaultConfig } from '../src/config.ts'
import { stubProviders } from '../src/providers.ts'
import { assignmentsOf, economic, holderOf, ledger, physical, totalMoney } from '../src/queries.ts'

describe('A1 (engine): the butcher shop changes hands, is leased, staffed, renovated and produces', () => {
  const providers = stubProviders({
    'salt-meat': { inputs: [{ good: 'meat', units: 1 }, { good: 'salt', units: 1 }], output: 'salt-meat', yield: 1, unitsPerFixtureDay: 10, labourHoursPerUnit: 2.5 },
    'smoked-meat': { inputs: [{ good: 'meat', units: 1 }], output: 'smoked-meat', yield: 1, unitsPerFixtureDay: 6, labourHoursPerUnit: 2.5 },
  })
  providers.labour.pools['pool.housing'] = 5
  providers.prices.values['bldg.0001'] = 60
  const r = new Runner(initialState('stl.port', 'the port'), defaultConfig(), providers)
  const dist = r.run<string>({ type: 'addDistrict', name: 'housing', kind: 'housing', bounds: { x: 0, y: 0, w: 40, h: 40 } })
  const parcel = r.run<string>({ type: 'addParcel', district: dist, footprint: { x: 0, y: 0, w: 10, h: 10 }, access: ['road'] })
  r.run({ type: 'grantTitle', subject: parcel, holder: 'esfp-f' })
  providers.materials.set('esfp-f', 'timber', 20)
  const build = r.run<string>({ type: 'startProject', kind: 'construct', target: parcel, account: 'esfp-f', labourHours: 0, materials: [{ material: 'timber', units: 10 }],
    plan: { footprint: { x: 1, y: 1, w: 8, h: 6 }, addFixtures: ['salting-house'],
      rooms: [{ id: 'shop', name: 'the shop', tiles: { x: 1, y: 1, w: 8, h: 4 }, use: 'work' }],
      placements: [{ fixture: 'salting-house', room: 'shop', at: { x: 2, y: 2 } }] } })
  r.tick()
  const bldg = r.state.projects[build].result!
  const title = r.run<string>({ type: 'grantTitle', subject: bldg, holder: 'esfp-f' })
  r.run({ type: 'assign', person: 'esfp-f', kind: 'residence', target: bldg })
  r.run({ type: 'assign', person: 'farm-son', kind: 'residence', target: bldg })
  for (const holder of ['player', 'esfp-f', 'farm-son']) r.run({ type: 'credit', holder, amount: 100 })
  const start = totalMoney(r.state)

  it('1. the player buys the building at the price provider value', () => {
    r.run({ type: 'sell', title, buyer: 'player', price: providers.prices.valueOf(bldg, r.state.settlement.day) })
    r.tick()
    expect(holderOf(r.state, bldg)).toBe('player')
    expect(ledger(r.state, { kind: 'sale' })).toHaveLength(1)
  })
  it('2. the player gives the title to the son', () => {
    r.run({ type: 'transfer', title, to: 'farm-son', kind: 'gift' })
    r.tick()
    expect(holderOf(r.state, bldg)).toBe('farm-son')
    expect(ledger(r.state, { kind: 'gift' })).toHaveLength(1)
  })
  let biz = ''
  it('3. the son leases the shop to the cook, who operates a butcher business the son manages', () => {
    r.run({ type: 'lease', title, tenant: 'esfp-f', scope: ['shop'], rent: 2 })
    biz = r.run<string>({ type: 'openBusiness', kind: 'butcher', premises: [{ bldg, rooms: ['shop'] }], operator: 'esfp-f', manager: 'farm-son', inventory: 'inv.butcher',
      lines: [{ recipe: 'salt-meat', equipment: ['salting-house'] }, { recipe: 'smoked-meat', equipment: ['smokehouse'] }] })
    r.run({ type: 'assign', person: 'farm-son', kind: 'management', target: biz })
    r.run({ type: 'credit', holder: biz, amount: 100 })
    r.tick()
    expect(r.state.businesses[biz].operator).toBe('esfp-f')
    expect(r.state.businesses[biz].manager).toBe('farm-son')
    expect(holderOf(r.state, bldg)).toBe('farm-son')
  })
  it('4. two posts: the cook by employment, a labourer from the pool', () => {
    const p1 = r.run<string>({ type: 'addPost', biz, role: 'butcher', wage: 2 })
    const p2 = r.run<string>({ type: 'addPost', biz, role: 'labourer', wage: 1 })
    r.run({ type: 'hire', post: p1, holder: 'esfp-f' })
    r.run({ type: 'hire', post: p2, holder: 'pool.housing' })
    r.tick()
    expect(economic(r.state, biz)).toBe('staffed')
    expect(assignmentsOf(r.state, 'esfp-f').map((entry) => entry.kind).sort()).toEqual(['employment', 'residence'])
    expect(assignmentsOf(r.state, 'farm-son').map((entry) => entry.kind).sort()).toEqual(['management', 'residence'])
  })
  it('5. a renovation adds a smokehouse in a new back room, paid by the operator', () => {
    providers.labour.pools['pool.builders'] = 1
    providers.materials.set('esfp-f', 'timber', 10)
    const proj = r.run<string>({ type: 'startProject', kind: 'renovate', target: bldg, account: 'esfp-f', pool: 'pool.builders', wage: 1, labourHours: 20,
      materials: [{ material: 'timber', units: 5 }],
      plan: { rooms: [{ id: 'back', name: 'back room', tiles: { x: 1, y: 5, w: 8, h: 2 }, use: 'smoke' }], addFixtures: ['smokehouse'],
        placements: [{ fixture: 'smokehouse', room: 'back', at: { x: 2, y: 5 } }] } })
    r.tick(2)
    expect(r.state.projects[proj].status).toBe('done')
    const built = r.state.buildings[bldg]
    expect(built.layout.version).toBe(2)
    expect(built.layout.rooms.map((room) => room.id)).toEqual(['shop', 'back'])
    expect(built.fixtures).toEqual(['salting-house', 'smokehouse'])
    expect(JSON.parse(JSON.stringify(r.state)).buildings[bldg].layout).toEqual(built.layout)
  })
  it('6. the business produces by the min rule; the smokehouse raises only the smoked line', () => {
    providers.materials.set('inv.butcher', 'meat', 100)
    providers.materials.set('inv.butcher', 'salt', 100)
    r.tick()
    const day = r.state.production[biz]!
    // labour: two posts, 2 worker-days, shared in order: salt-meat takes min(10, 8, 100, inf) = 8 -> 2 days used; smoked gets 0 labour
    expect(day.lines[0]).toMatchObject({ recipe: 'salt-meat', q: 8 })
    expect(day.lines[0].caps.equipment).toBe(10)
    expect(day.lines[1].recipe).toBe('smoked-meat')
    expect(day.lines[1].caps.equipment).toBe(6)
    expect(day.lines[1].q).toBe(0)
    expect(economic(r.state, biz)).toBe('producing')
    expect(providers.materials.get('inv.butcher', 'salt-meat')).toBe(8)
    expect(physical(r.state, bldg, defaultConfig())).toBe('fine')
  })
  it('the ledger holds exactly the sale, the gift, the lease, the wages, the rents and the project draws; money is conserved', () => {
    const kinds = ledger(r.state).map((row) => row.kind)
    expect(kinds.filter((kind) => kind === 'sale')).toHaveLength(1)
    expect(kinds.filter((kind) => kind === 'gift')).toHaveLength(1)
    expect(kinds.filter((kind) => kind === 'lease')).toHaveLength(1)
    expect(kinds.filter((kind) => kind === 'rent').length).toBeGreaterThan(0)
    expect(kinds.filter((kind) => kind === 'wage').length).toBeGreaterThan(0)
    expect(totalMoney(r.state)).toBe(start + 100)   // the one credit to the business account in step 3; nothing else moved the total
    expect(r.events.filter((event) => event.type === 'titleChanged')).toHaveLength(2)
  })
})
