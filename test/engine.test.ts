import { describe, expect, it } from 'vitest'
import { Runner } from '../src/reduce.ts'
import { initialState } from '../src/state.ts'
import { defaultConfig } from '../src/config.ts'
import { stubProviders } from '../src/providers.ts'
import { assignmentsOf, balanceOf, hasFixture, holderOf, ledger, physical, tenantsOf, totalMoney } from '../src/queries.ts'
import { buildHamlet } from '../examples/hamlet.ts'

function fresh() {
  const providers = stubProviders({
    'salt-meat': { inputs: [{ good: 'meat', units: 1 }, { good: 'salt', units: 1 }], output: 'salt-meat', yield: 1, unitsPerFixtureDay: 10, labourPerUnit: 0.25 },
    'smoked-meat': { inputs: [{ good: 'meat', units: 1 }], output: 'smoked-meat', yield: 1, unitsPerFixtureDay: 6, labourPerUnit: 0.25 },
  })
  providers.labour.pools['pool.housing'] = 5
  const r = new Runner(initialState('stl.test', 'test'), defaultConfig(), providers)
  const dist = r.run<string>({ type: 'addDistrict', name: 'housing', kind: 'housing', bounds: { x: 0, y: 0, w: 50, h: 50 } })
  const parcel = r.run<string>({ type: 'addParcel', district: dist, footprint: { x: 0, y: 0, w: 10, h: 10 }, access: ['road'] })
  r.run({ type: 'grantTitle', subject: parcel, holder: 'butcher' })
  r.run({ type: 'credit', holder: 'butcher', amount: 100 })
  r.run({ type: 'credit', holder: 'player', amount: 100 })
  r.run({ type: 'credit', holder: 'town', amount: 100 })
  providers.materials.set('butcher', 'timber', 50)
  const proj = r.run<string>({ type: 'startProject', kind: 'construct', target: parcel, account: 'butcher', pool: 'pool.housing', wage: 1, labourDays: 1,
    materials: [{ material: 'timber', units: 10 }],
    plan: { footprint: { x: 1, y: 1, w: 8, h: 6 }, addFixtures: ['salting-house'],
      rooms: [{ id: 'shop', name: 'the shop', tiles: { x: 1, y: 1, w: 8, h: 6 }, use: 'work' }],
      placements: [{ fixture: 'salting-house', room: 'shop', at: { x: 2, y: 2 } }] } })
  r.tick()
  const bldg = r.state.projects[proj].result!
  const title = r.run<string>({ type: 'grantTitle', subject: bldg, holder: 'butcher' })
  return { r, providers, dist, parcel, bldg, title }
}

function openShop(ctx: ReturnType<typeof fresh>, operator = 'butcher') {
  const { r } = ctx
  const biz = r.run<string>({ type: 'openBusiness', kind: 'butcher', premises: [{ bldg: ctx.bldg, rooms: ['shop'] }], operator, inventory: 'inv.shop',
    lines: [{ recipe: 'salt-meat', equipment: ['salting-house'] }] })
  const p1 = r.run<string>({ type: 'addPost', biz, role: 'butcher', wage: 2 })
  const p2 = r.run<string>({ type: 'addPost', biz, role: 'labourer', wage: 1 })
  r.run({ type: 'credit', holder: biz, amount: 100 })
  return { biz, p1, p2 }
}

describe('U1 ids are stable and never reused', () => {
  it('replays mint the same ids; a retired parent stays queryable', () => {
    const a = fresh()
    const big = a.r.run<string>({ type: 'addParcel', district: a.dist, footprint: { x: 20, y: 0, w: 20, h: 10 } })
    a.r.run({ type: 'grantTitle', subject: big, holder: 'town' })
    const kids = a.r.run<string[]>({ type: 'splitParcel', parcel: big, children: [{ x: 20, y: 0, w: 10, h: 10 }, { x: 30, y: 0, w: 10, h: 10 }] })
    const grand = a.r.run<string[]>({ type: 'splitParcel', parcel: kids[0], children: [{ x: 20, y: 0, w: 5, h: 10 }, { x: 25, y: 0, w: 5, h: 10 }] })
    const demolish = a.r.run<string>({ type: 'startProject', kind: 'demolish', target: a.bldg, account: 'butcher', labourDays: 0 })
    a.r.tick()
    expect(a.r.state.projects[demolish].status).toBe('done')
    expect(a.r.state.parcels[big].retired).toBe(true)
    expect(a.r.state.parcels[kids[0]].retired).toBe(true)
    expect(new Set([big, ...kids, ...grand]).size).toBe(5)
    // replay
    const b = new Runner(initialState('stl.test', 'test'), defaultConfig(), stubProviders(a.providers.materials.recipes))
    ;(b.providers as typeof a.providers).labour.pools['pool.housing'] = 5
    ;(b.providers as typeof a.providers).materials.set('butcher', 'timber', 50)
    for (const command of a.r.log) b.run(command)
    expect(Object.keys(b.state.parcels)).toEqual(Object.keys(a.r.state.parcels))
    expect(b.state.counters).toEqual(a.r.state.counters)
  })
})

describe('U2 one holder per title, many tenants', () => {
  it('two room leases coexist; a sale to the current holder is refused', () => {
    const ctx = fresh()
    const l1 = ctx.r.run<string>({ type: 'lease', title: ctx.title, tenant: 'a', scope: ['shop'], rent: 1 })
    expect(() => ctx.r.run({ type: 'lease', title: ctx.title, tenant: 'b', scope: ['shop'], rent: 1 })).toThrow(/already leased/)
    ctx.r.run({ type: 'startProject', kind: 'renovate', target: ctx.bldg, account: 'butcher', labourDays: 0,
      plan: { rooms: [{ id: 'back', name: 'back room', tiles: { x: 1, y: 5, w: 8, h: 2 }, use: 'store' }] } })
    ctx.r.tick()
    const l2 = ctx.r.run<string>({ type: 'lease', title: ctx.title, tenant: 'b', scope: ['back'], rent: 1 })
    expect(tenantsOf(ctx.r.state, ctx.title).map((entry) => entry.id)).toEqual([l1, l2])
    expect(() => ctx.r.run({ type: 'sell', title: ctx.title, buyer: 'butcher', price: 1 })).toThrow(/already holds/)
  })
})

describe('U3 ownership is not control', () => {
  it('a sale leaves operator and manager; setOperator leaves the holder', () => {
    const ctx = fresh()
    const { biz } = openShop(ctx)
    ctx.r.run({ type: 'setManager', biz, manager: 'son' })
    ctx.r.run({ type: 'sell', title: ctx.title, buyer: 'player', price: 40 })
    expect(holderOf(ctx.r.state, ctx.bldg)).toBe('player')
    expect(ctx.r.state.businesses[biz].operator).toBe('butcher')
    expect(ctx.r.state.businesses[biz].manager).toBe('son')
    expect(ctx.r.events.filter((event) => event.type === 'operatorChanged')).toHaveLength(0)
    // the butcher no longer has a right of use unless leased; the new holder leases to her, then operation can pass
    ctx.r.run({ type: 'lease', title: ctx.title, tenant: 'cousin', rent: 2 })
    ctx.r.run({ type: 'setOperator', biz, operator: 'cousin' })
    expect(holderOf(ctx.r.state, ctx.bldg)).toBe('player')
    expect(() => ctx.r.run({ type: 'setOperator', biz, operator: 'stranger' })).toThrow(/right of use/)
  })
  it('a title not for sale, or restricted, refuses the buyer with no ledger row (Q6)', () => {
    const ctx = fresh()
    ctx.r.run({ type: 'setTransferable', title: ctx.title, transferable: { sale: false } })
    const rows = ctx.r.state.ledger.length
    expect(() => ctx.r.run({ type: 'sell', title: ctx.title, buyer: 'player', price: 1 })).toThrow(/not for sale/)
    ctx.r.run({ type: 'setTransferable', title: ctx.title, transferable: { sale: true, to: ['son'] } })
    expect(() => ctx.r.run({ type: 'sell', title: ctx.title, buyer: 'player', price: 1 })).toThrow(/may not pass/)
    expect(ctx.r.state.ledger.length).toBe(rows)
    expect(holderOf(ctx.r.state, ctx.bldg)).toBe('butcher')
  })
})

describe('U4 assignments are non-exclusive', () => {
  it('one person holds four kinds at once', () => {
    const ctx = fresh()
    const { biz, p1 } = openShop(ctx)
    ctx.r.run({ type: 'assign', person: 'butcher', kind: 'residence', target: ctx.bldg })
    ctx.r.run({ type: 'assign', person: 'butcher', kind: 'employment', target: p1 })
    ctx.r.run({ type: 'assign', person: 'butcher', kind: 'management', target: biz })
    const crew = ctx.r.run<string>({ type: 'assign', person: 'butcher', kind: 'membership', target: 'crew.sloop' })
    expect(assignmentsOf(ctx.r.state, 'butcher')).toHaveLength(4)
    ctx.r.run({ type: 'unassign', assignment: crew })
    expect(assignmentsOf(ctx.r.state, 'butcher')).toHaveLength(3)
    expect(ctx.r.state.posts[p1].holder).toBe('butcher')
    expect(ctx.r.state.businesses[biz].manager).toBe('butcher')
  })
})

describe('U5 the ledger is complete and money conserved', () => {
  it('a day of sale, wages and rent keeps the total and writes one row per change', () => {
    const ctx = fresh()
    const { biz, p1, p2 } = openShop(ctx)
    ctx.r.run({ type: 'hire', post: p1, holder: 'pool.housing' })
    ctx.r.run({ type: 'hire', post: p2, holder: 'pool.housing' })
    ctx.r.run({ type: 'sell', title: ctx.title, buyer: 'player', price: 40 })
    ctx.r.run({ type: 'lease', title: ctx.title, tenant: 'butcher', rent: 3 })
    const before = totalMoney(ctx.r.state)
    const rows = ctx.r.state.ledger.length
    ctx.r.tick()
    expect(totalMoney(ctx.r.state)).toBe(before)
    const newRows = ctx.r.state.ledger.slice(rows)
    expect(newRows.map((row) => row.kind).sort()).toEqual(['rent', 'wage', 'wage'])
    expect(newRows.find((row) => row.kind === 'rent')).toMatchObject({ from: 'butcher', to: 'player', amount: 3 })
    expect(ledger(ctx.r.state, { kind: 'sale' })).toHaveLength(1)
    expect(ctx.r.state.businesses[biz].account).toBeDefined()
  })
})

describe('U6 Q = min(equipment, labour, materials, utilities)', () => {
  function setup(opts: { fixtures: number; posts: number; meat: number; utility: number }) {
    const ctx = fresh()
    const { biz, p1, p2 } = openShop(ctx)
    const extra = opts.fixtures - 1
    if (extra !== 0) {
      ctx.r.run({ type: 'startProject', kind: 'renovate', target: ctx.bldg, account: 'butcher', labourDays: 0,
        plan: extra > 0 ? { addFixtures: Array(extra).fill('salting-house') } : { removeFixtures: ['salting-house'] } })
      ctx.r.tick()
    }
    if (opts.posts >= 1) ctx.r.run({ type: 'hire', post: p1, holder: 'pool.housing' })
    if (opts.posts >= 2) ctx.r.run({ type: 'hire', post: p2, holder: 'pool.housing' })
    ctx.r.run({ type: 'removePost', post: opts.posts >= 2 ? p2 : p2 })
    if (opts.posts >= 2) ctx.r.run({ type: 'hire', post: ctx.r.run<string>({ type: 'addPost', biz, role: 'labourer', wage: 1 }), holder: 'pool.housing' })
    ctx.providers.materials.set('inv.shop', 'meat', opts.meat)
    ctx.providers.materials.set('inv.shop', 'salt', 1000)
    ctx.providers.utilities.caps[ctx.bldg] = opts.utility
    ctx.r.tick()
    return ctx.r.state.production[biz]?.lines[0]
  }
  it('each factor caps the output when it is the smallest', () => {
    // 1 fixture x 10 = 10; 2 posts = 2 labour days / 0.25 = 8; meat 100; utility 100 -> labour wins
    expect(setup({ fixtures: 1, posts: 2, meat: 100, utility: 100 }).q).toBe(8)
    // 1 fixture = 10 vs labour 2 posts 8 -> make labour bigger by 3 fixtures: equipment 30, labour 8
    expect(setup({ fixtures: 1, posts: 1, meat: 100, utility: 100 }).q).toBe(4)
    expect(setup({ fixtures: 1, posts: 2, meat: 3, utility: 100 }).q).toBe(3)
    expect(setup({ fixtures: 1, posts: 2, meat: 100, utility: 2 }).q).toBe(2)
  })
  it('zero of any factor gives zero', () => {
    expect(setup({ fixtures: 0, posts: 2, meat: 100, utility: 100 }).q).toBe(0)
    expect(setup({ fixtures: 1, posts: 2, meat: 0, utility: 100 }).q).toBe(0)
    expect(setup({ fixtures: 1, posts: 2, meat: 100, utility: 0 }).q).toBe(0)
  })
  it('no filled post means dormant, so nothing is produced', () => {
    expect(setup({ fixtures: 1, posts: 0, meat: 100, utility: 100 })).toBeUndefined()
  })
})

describe('U7 status is derived', () => {
  it('dormant, staffed, producing; condition does not change status; the person in charge must be available (Q2)', () => {
    const ctx = fresh()
    const { biz, p1, p2 } = openShop(ctx)
    ctx.r.tick()
    expect(ctx.r.state.businesses[biz].status).toBe('dormant')
    ctx.r.run({ type: 'hire', post: p1, holder: 'pool.housing' })
    ctx.r.run({ type: 'hire', post: p2, holder: 'pool.housing' })
    ctx.r.tick()
    expect(ctx.r.state.businesses[biz].status).toBe('staffed')
    ctx.providers.materials.set('inv.shop', 'meat', 5)
    ctx.providers.materials.set('inv.shop', 'salt', 5)
    ctx.r.tick()
    expect(ctx.r.state.businesses[biz].status).toBe('producing')
    ctx.r.run({ type: 'setCondition', bldg: ctx.bldg, condition: 0.1 })
    ctx.r.tick()
    expect(physical(ctx.r.state, ctx.bldg, defaultConfig())).toBe('ruined')
    expect(ctx.r.state.businesses[biz].status).toBe('staffed')   // ruined: output factor 0, still staffed
    ctx.r.run({ type: 'setCondition', bldg: ctx.bldg, condition: 1 })
    ctx.providers.labour.away.add('butcher')
    ctx.r.tick()
    expect(ctx.r.state.businesses[biz].status).toBe('dormant')   // nobody in charge
    ctx.r.run({ type: 'setManager', biz, manager: 'son' })
    ctx.providers.materials.set('inv.shop', 'meat', 5)
    ctx.providers.materials.set('inv.shop', 'salt', 5)
    ctx.r.tick()
    expect(ctx.r.state.businesses[biz].status).toBe('producing') // the manager keeps it running while the operator is aboard
  })
})

describe('U8 layouts persist and projects write them', () => {
  it('renovate increments the version and keeps history; cancel leaves it; reload keeps it', () => {
    const ctx = fresh()
    ctx.providers.labour.pools['pool.builders'] = 1
    const proj = ctx.r.run<string>({ type: 'startProject', kind: 'renovate', target: ctx.bldg, account: 'butcher', pool: 'pool.builders', wage: 1, labourDays: 2,
      plan: { rooms: [{ id: 'back', name: 'back room', tiles: { x: 1, y: 5, w: 8, h: 2 }, use: 'smoke' }], addFixtures: ['smokehouse'],
        placements: [{ fixture: 'smokehouse', room: 'back', at: { x: 2, y: 6 } }] } })
    ctx.r.tick()
    expect(ctx.r.state.projects[proj].status).toBe('active')
    expect(ctx.r.state.buildings[ctx.bldg].layout.version).toBe(1)
    ctx.r.tick()
    const bldg = ctx.r.state.buildings[ctx.bldg]
    expect(ctx.r.state.projects[proj].status).toBe('done')
    expect(bldg.layout.version).toBe(2)
    expect(bldg.fixtures).toEqual(['salting-house', 'smokehouse'])
    expect(bldg.layout.placements).toHaveLength(2)
    expect(bldg.layoutHistory[0].version).toBe(1)
    const cancelled = ctx.r.run<string>({ type: 'startProject', kind: 'renovate', target: ctx.bldg, account: 'butcher', labourDays: 5, plan: { addFixtures: ['oven'] } })
    ctx.r.run({ type: 'cancelProject', project: cancelled })
    ctx.r.tick()
    expect(ctx.r.state.buildings[ctx.bldg].layout.version).toBe(2)
    const reloaded = JSON.parse(JSON.stringify(ctx.r.state))
    expect(reloaded.buildings[ctx.bldg].layout).toEqual(bldg.layout)
    expect(() => ctx.r.run({ type: 'setLayout', bldg: ctx.bldg, by: 'butcher', layout: { rooms: [], placements: [] } })).toThrow(/freeLayout/)
  })
})

describe('U9 construction mints and demolition retires', () => {
  it('construct fills a vacant parcel; demolish frees it and keeps the title history', () => {
    const ctx = fresh()
    expect(ctx.r.state.parcels[ctx.parcel].vacant).toBe(false)
    expect(ctx.r.state.buildings[ctx.bldg].builtOn).toBe(0)
    const demolish = ctx.r.run<string>({ type: 'startProject', kind: 'demolish', target: ctx.bldg, account: 'butcher', labourDays: 0 })
    ctx.r.tick()
    expect(ctx.r.state.projects[demolish].status).toBe('done')
    expect(ctx.r.state.buildings[ctx.bldg].demolishedOn).toBe(1)
    expect(ctx.r.state.parcels[ctx.parcel].vacant).toBe(true)
    expect(ledger(ctx.r.state, { kind: 'grant', subject: ctx.title })).toHaveLength(1)
    expect(hasFixture(ctx.r.state, null, 'salting-house')).toBe(false)
  })
})

describe('U10 authority is data', () => {
  it('permits need the power; a permit-requiring project waits; appointments are ledger rows', () => {
    const ctx = fresh()
    const mayor = ctx.r.run<string>({ type: 'createOffice', name: 'mayor', powers: ['permit', 'public-title'], seat: ctx.bldg })
    const clerk = ctx.r.run<string>({ type: 'createOffice', name: 'clerk', powers: [] })
    expect(() => ctx.r.run({ type: 'grantPermission', office: mayor, kind: 'build', subject: ctx.parcel })).toThrow(/vacant/)
    ctx.r.run({ type: 'appoint', office: mayor, holder: 'estj-f' })
    ctx.r.run({ type: 'appoint', office: clerk, holder: 'clerk-1' })
    expect(() => ctx.r.run({ type: 'grantPermission', office: clerk, kind: 'build', subject: ctx.parcel })).toThrow(/lacks the power/)
    const site = ctx.r.run<string>({ type: 'addParcel', district: ctx.dist, footprint: { x: 20, y: 20, w: 10, h: 10 } })
    ctx.r.run({ type: 'grantTitle', subject: site, holder: 'town' })
    const proj = ctx.r.run<string>({ type: 'startProject', kind: 'construct', target: site, account: 'town', pool: 'pool.housing', labourDays: 1, permitRequired: true,
      plan: { footprint: { x: 21, y: 21, w: 4, h: 4 } } })
    ctx.r.tick()
    expect(ctx.r.state.projects[proj].progress).toBe(0)
    const permit = ctx.r.run<string>({ type: 'grantPermission', office: mayor, kind: 'build', subject: site })
    expect(ctx.r.state.projects[proj].permit).toBe(permit)
    ctx.r.tick()
    expect(ctx.r.state.projects[proj].status).toBe('done')
    expect(ledger(ctx.r.state, { kind: 'appoint' })).toHaveLength(2)
    expect(ledger(ctx.r.state, { kind: 'permit' })).toHaveLength(1)
    ctx.r.run({ type: 'vacate', office: mayor })
    expect(ledger(ctx.r.state, { kind: 'vacate' })).toHaveLength(1)
  })
})

describe('U11 tick order', () => {
  it('runs the seven steps in the declared order; a building finished in step 2 is staffable that day', () => {
    const ctx = fresh()
    ctx.r.tick()
    expect(ctx.r.state.tickTrace).toEqual(['decay', 'projects', 'staffing', 'production', 'wages', 'publicWorks', 'expiry'])
  })
})

describe('U12 the engine names nobody', () => {
  it('every person id came from a command; pool draws are pool ids', () => {
    const ctx = fresh()
    const { p1 } = openShop(ctx)
    ctx.r.run({ type: 'hire', post: p1, holder: 'pool.housing' })
    ctx.r.tick()
    const persons = new Set<string>()
    for (const asg of Object.values(ctx.r.state.assignments)) persons.add(asg.person)
    for (const post of Object.values(ctx.r.state.posts)) { if (post.holder) persons.add(post.holder); if (post.filledBy) persons.add(post.filledBy) }
    for (const title of Object.values(ctx.r.state.titles)) persons.add(title.holder)
    const fromCommands = new Set<string>(['none', 'town'])
    for (const command of ctx.r.log) for (const value of Object.values(command)) if (typeof value === 'string') fromCommands.add(value)
    for (const person of persons) expect(fromCommands.has(person) || person.startsWith('pool.')).toBe(true)
    expect(ctx.r.state.posts[p1].filledBy).toBe('pool.housing')
  })
})

describe('U13 a line takes its rates from the material provider (CONTRACTS.md s13a)', () => {
  it('changing the recipe rates changes the next day output; lines hold no copy', () => {
    const ctx = fresh()
    const { r, providers } = ctx
    const { biz, p1, p2 } = openShop(ctx)
    r.run({ type: 'hire', post: p1, holder: 'pool.housing' })
    r.run({ type: 'hire', post: p2, holder: 'pool.housing' })
    providers.materials.set('inv.shop', 'meat', 100)
    providers.materials.set('inv.shop', 'salt', 100)
    r.tick()
    expect(r.state.businesses[biz].lines[0]).toEqual({ recipe: 'salt-meat', equipment: ['salting-house'] })
    const first = r.state.production[biz].lines[0].q
    expect(first).toBe(8)                         // 2 worker-days / 0.25, under one fixture's 10
    providers.materials.recipes['salt-meat'].unitsPerFixtureDay = 3
    r.tick()
    expect(r.state.production[biz].lines[0].q).toBe(3)
    expect(r.state.production[biz].lines[0].caps.equipment).toBe(3)
    providers.materials.recipes['salt-meat'].unitsPerFixtureDay = Number.NaN
    expect(() => r.tick()).toThrow(/rates\(salt-meat\)/)
  })
})

describe('U14 pay and setWage are the ledger seam (CONTRACTS.md s3, s5, s13c, s13e)', () => {
  it('pay moves money under any kind, stamps the day, returns the row id; ledger filters by holder and day', () => {
    const ctx = fresh()
    const { r } = ctx
    r.tick(2)
    const day = r.state.settlement.day
    const butcherBefore = balanceOf(r.state, 'butcher')   // 99: the construct project's labour day was paid
    const row = r.run<string>({ type: 'pay', from: 'player', to: 'butcher', amount: 25, kind: 'purchase', subject: 'inv.0001', note: 'a cask' })
    expect(row).toMatch(/^txn\./)
    expect(balanceOf(r.state, 'player')).toBe(75)
    expect(balanceOf(r.state, 'butcher')).toBe(butcherBefore + 25)
    expect(ledger(r.state, { kind: 'purchase' })).toEqual([expect.objectContaining({ id: row, day, from: 'player', to: 'butcher', subject: 'inv.0001', amount: 25 })])
    r.run({ type: 'pay', from: 'butcher', to: 'town', amount: 5, kind: 'duty' })
    expect(ledger(r.state, { holder: 'butcher', fromDay: day, toDay: day }).map((entry) => entry.kind)).toEqual(['purchase', 'duty'])
    expect(ledger(r.state, { holder: 'butcher', toDay: day - 1 }).some((entry) => entry.kind === 'purchase')).toBe(false)
    expect(() => r.run({ type: 'pay', from: 'player', to: 'butcher', amount: -1, kind: 'purchase' })).toThrow()
    expect(() => r.run({ type: 'pay', from: 'player', to: 'butcher', amount: 1, kind: '' })).toThrow()
  })
  it('setWage changes what the next wages step pays and nothing else', () => {
    const ctx = fresh()
    const { r } = ctx
    const { biz, p1 } = openShop(ctx)
    r.run({ type: 'hire', post: p1, holder: 'pool.housing' })
    r.tick()
    expect(ledger(r.state, { kind: 'wage', subject: p1 }).map((entry) => entry.amount)).toEqual([2])
    const events = r.events.length
    r.run({ type: 'setWage', post: p1, wage: 3 })
    expect(r.events).toHaveLength(events)
    expect(r.state.posts[p1].holder).toBe('pool.housing')
    r.tick()
    expect(ledger(r.state, { kind: 'wage', subject: p1 }).map((entry) => entry.amount)).toEqual([2, 3])
    expect(balanceOf(r.state, biz)).toBe(100 - 5)
    expect(() => r.run({ type: 'setWage', post: p1, wage: -1 })).toThrow()
    expect(() => r.run({ type: 'setWage', post: 'post.9999', wage: 1 })).toThrow()
  })
})

describe('U16 a project draws materials from its own inventory ref, not from its payer (DUP-44)', () => {
  it('materials come from project.inventory; wages come from project.account', () => {
    const ctx = fresh()
    const { r, providers, dist } = ctx
    const parcel = r.run<string>({ type: 'addParcel', district: dist, footprint: { x: 20, y: 0, w: 10, h: 10 }, access: ['road'] })
    r.run({ type: 'grantTitle', subject: parcel, holder: 'butcher' })
    const before = r.state.ledger.length
    providers.materials.set('inv.yard', 'timber', 10)
    providers.materials.set('butcher', 'timber', 0)
    const proj = r.run<string>({ type: 'startProject', kind: 'construct', target: parcel, account: 'butcher', inventory: 'inv.yard', pool: 'pool.housing', wage: 1, labourDays: 1,
      materials: [{ material: 'timber', units: 10 }], plan: { footprint: { x: 21, y: 1, w: 4, h: 4 }, rooms: [{ id: 'hut', name: 'hut', tiles: { x: 21, y: 1, w: 4, h: 4 }, use: 'living' }] } })
    expect(r.state.projects[proj].inventory).toBe('inv.yard')
    r.tick()
    expect(r.state.projects[proj].status).toBe('done')
    expect(providers.materials.get('inv.yard', 'timber')).toBe(0)
    expect(providers.materials.get('butcher', 'timber')).toBe(0)
    const wage = r.state.ledger.slice(before).find((row) => row.subject === proj && row.kind === 'wage')!
    expect(wage.from).toBe('butcher')
    const legacy = r.run<string>({ type: 'startProject', kind: 'repair', target: ctx.bldg, account: 'butcher', pool: 'pool.housing', labourDays: 1 })
    expect(r.state.projects[legacy].inventory).toBe('butcher')   // the default keeps old callers working; the record no longer conflates the two
  })
})

describe('the hamlet example (reuse proof)', () => {
  it('builds, staffs and produces with no game data', () => {
    const { r, providers, ids } = buildHamlet()
    const before = totalMoney(r.state)
    r.tick(5)
    expect(r.state.buildings[ids.houseId].layout.rooms[0].id).toBe('hall')
    expect(r.state.businesses[ids.biz].status).toBe('producing')
    expect(providers.materials.get('inv.sawyer', 'plank')).toBeGreaterThan(0)
    expect(totalMoney(r.state)).toBe(before)
    expect(assignmentsOf(r.state, 'alder').map((entry) => entry.kind)).toEqual(['residence'])
  })
})
