import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import { canonical } from '@rex/kernel'
import * as kernel from '@rex/kernel'
import * as commands from '../src/commands.ts'
import * as ticks from '../src/tick/index.ts'
import { hasRightOfUse } from '../src/index.ts'
import { Runner } from '../src/reduce.ts'
import { initialState } from '../src/state.ts'
import { defaultConfig } from '../src/config.ts'
import { stubProviders, StubLabour, StubLabourSupply, officePowersAuthority, type AuthorityAnswer } from '../src/providers.ts'
import { assignmentsOf, availableOf, balanceOf, hasFixture, holderOf, ledger, physical, tenantsOf, totalMoney, totalOf } from '../src/queries.ts'
import { buildHamlet } from '../examples/hamlet.ts'
import { officeHas, type Ctx } from '../src/context.ts'

function fresh() {
  const providers = stubProviders({
    'salt-meat': { inputs: [{ good: 'meat', units: 1 }, { good: 'salt', units: 1 }], output: 'salt-meat', yield: 1, unitsPerFixtureDay: 10, labourHoursPerUnit: 2.5 },
    'smoked-meat': { inputs: [{ good: 'meat', units: 1 }], output: 'smoked-meat', yield: 1, unitsPerFixtureDay: 6, labourHoursPerUnit: 2.5 },
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
  const proj = r.run<string>({ type: 'startProject', kind: 'construct', target: parcel, account: 'butcher', pool: 'pool.housing', wage: 1, labourHours: 10,
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

describe('U30 funding holds', () => {
  function funded() {
    const r = new Runner(initialState('stl.holds', 'holds'))
    r.run({ type: 'credit', holder: 'payer', amount: 100 })
    return r
  }

  it('(a) a hold within available reserves funds without a payment or balance change', () => {
    const r = funded()
    const rows = structuredClone(r.state.ledger)
    r.run({ type: 'hold', account: 'payer', amount: 60, ref: 'decision.1' })
    expect(r.state.holds).toEqual({ 'decision.1': {
      ref: 'decision.1', account: 'payer', amount: 60, currency: 'money', status: 'active', settled: 0,
    } })
    expect(availableOf(r.state, 'payer')).toBe(40)
    expect(balanceOf(r.state, 'payer')).toBe(100)
    expect(availableOf(r.state, 'other')).toBe(0)
    expect(r.state.ledger).toEqual(rows)
  })

  it('(b) a second hold above the remainder is refused without changing state or log', () => {
    const r = funded()
    r.run({ type: 'hold', account: 'payer', amount: 60, ref: 'decision.1' })
    const before = canonical({ state: r.state, events: r.events, log: r.log })
    expect(() => r.run({ type: 'hold', account: 'payer', amount: 41, ref: 'decision.2' }))
      .toThrow('hold: 41 exceeds available 40 on payer')
    expect(canonical({ state: r.state, events: r.events, log: r.log })).toBe(before)
    r.run({ type: 'hold', account: 'payer', amount: 40, ref: 'decision.2' })
    expect(availableOf(r.state, 'payer')).toBe(0)
  })

  it.each(['active', 'released', 'settled'] as const)('(c) duplicate refs throw even when %s', (status) => {
    const r = funded()
    r.run({ type: 'hold', account: 'payer', amount: 60, ref: 'decision.1' })
    if (status === 'released') r.run({ type: 'release', ref: 'decision.1' })
    if (status === 'settled') r.run({ type: 'settle', ref: 'decision.1', payee: 'payee' })
    const before = canonical(r.state)
    expect(() => r.run({ type: 'hold', account: 'other', amount: 0, ref: 'decision.1' })).toThrow('duplicate ref')
    expect(canonical(r.state)).toBe(before)
  })

  it('(d) release frees available without changing balances or adding a ledger row', () => {
    const r = funded()
    r.run({ type: 'hold', account: 'payer', amount: 60, ref: 'decision.1' })
    const rows = structuredClone(r.state.ledger)
    r.run({ type: 'release', ref: 'decision.1' })
    expect(r.state.holds!['decision.1']).toMatchObject({ status: 'released', settled: 0 })
    expect(availableOf(r.state, 'payer')).toBe(100)
    expect(balanceOf(r.state, 'payer')).toBe(100)
    expect(r.state.ledger).toEqual(rows)
  })

  it('(e) full settle uses one kernel transfer and one payment with the ref, conserving money', () => {
    const r = funded()
    r.run({ type: 'hold', account: 'payer', amount: 60, ref: 'decision.1' })
    const total = totalOf(r.state, 'money')
    const rows = r.state.ledger.length
    const transfer = vi.spyOn(kernel, 'transfer')
    try {
      const txn = r.run<string>({ type: 'settle', ref: 'decision.1', payee: 'payee' })
      expect(transfer).toHaveBeenCalledTimes(1)
      expect(r.state.ledger.slice(rows)).toEqual([{
        id: txn, day: 0, kind: 'transfer', from: 'payer', to: 'payee', subject: 'decision.1',
        amount: 60, authority: null, note: '',
      }])
    } finally { transfer.mockRestore() }
    expect(r.state.holds!['decision.1']).toMatchObject({ status: 'settled', settled: 60 })
    expect(balanceOf(r.state, 'payer')).toBe(40)
    expect(balanceOf(r.state, 'payee')).toBe(60)
    expect(availableOf(r.state, 'payer')).toBe(40)
    expect(totalOf(r.state, 'money')).toBe(total)
  })

  it('(f) partial settle keeps the remainder held until release', () => {
    const r = funded()
    r.run({ type: 'hold', account: 'payer', amount: 60, ref: 'decision.1' })
    r.run({ type: 'settle', ref: 'decision.1', payee: 'payee', amount: 25 })
    expect(r.state.holds!['decision.1']).toMatchObject({ status: 'active', settled: 25 })
    expect(availableOf(r.state, 'payer')).toBe(40)
    expect(balanceOf(r.state, 'payer')).toBe(75)
    const rows = structuredClone(r.state.ledger)
    r.run({ type: 'release', ref: 'decision.1' })
    expect(r.state.holds!['decision.1']).toMatchObject({ status: 'released', settled: 25 })
    expect(availableOf(r.state, 'payer')).toBe(75)
    expect(balanceOf(r.state, 'payer')).toBe(75)
    expect(r.state.ledger).toEqual(rows)
    expect(ledger(r.state, { subject: 'decision.1' })).toHaveLength(1)
    expect(ledger(r.state, { subject: 'decision.1' })[0].amount).toBe(25)
  })

  it('(g) settle above the remaining hold throws without a payment or state change', () => {
    const r = funded()
    r.run({ type: 'hold', account: 'payer', amount: 60, ref: 'decision.1' })
    r.run({ type: 'settle', ref: 'decision.1', payee: 'payee', amount: 25 })
    const before = canonical({ state: r.state, events: r.events, log: r.log })
    expect(() => r.run({ type: 'settle', ref: 'decision.1', payee: 'payee', amount: 36 })).toThrow('exceeds remainder 35')
    expect(canonical({ state: r.state, events: r.events, log: r.log })).toBe(before)
  })

  it('(h) holds and payments are isolated by holder and declared currency', () => {
    const r = funded()
    r.providers.currencies = { isCurrency: (id) => id === 'silver' }
    r.run({ type: 'credit', holder: 'payer', amount: 80, currency: 'silver', process: 'test.issue' })
    r.run({ type: 'hold', account: 'payer', amount: 60, ref: 'money.1' })
    r.run({ type: 'hold', account: 'payer', amount: 70, ref: 'silver.1', currency: 'silver' })
    expect(availableOf(r.state, 'payer')).toBe(40)
    expect(availableOf(r.state, 'payer', 'silver')).toBe(10)
    expect(availableOf(r.state, 'other', 'silver')).toBe(0)
    const total = totalOf(r.state, 'silver')
    const rows = r.state.ledger.length
    r.run({ type: 'settle', ref: 'silver.1', payee: 'payee' })
    expect(r.state.ledger.slice(rows)).toHaveLength(1)
    expect(r.state.ledger[rows]).toMatchObject({ from: 'payer', to: 'payee', subject: 'silver.1', amount: 70, currency: 'silver' })
    expect(r.state.holds!['silver.1']).toMatchObject({ currency: 'silver', status: 'settled', settled: 70 })
    expect(balanceOf(r.state, 'payee', 'silver')).toBe(70)
    expect(availableOf(r.state, 'payer', 'silver')).toBe(10)
    expect(availableOf(r.state, 'payer')).toBe(40)
    expect(totalOf(r.state, 'silver')).toBe(total)
  })

  it.each(['hold', 'tick'] as const)('(i) a hold created inside a failing %s reduce is rolled back', (type) => {
    const r = funded()
    const before = canonical({ state: r.state, events: r.events, log: r.log })
    const create = commands.hold
    const fail = (ctx: Ctx) => {
      create(ctx, { type: 'hold', account: 'payer', amount: 60, ref: 'rolled-back' })
      expect(ctx.state.holds!['rolled-back'].status).toBe('active')
      throw new Error('failure after hold')
    }
    // Inject a failure after a real hold mutation on the reducer's copied state.
    const handler = type === 'hold' ? vi.spyOn(commands, 'hold').mockImplementation(fail)
      : vi.spyOn(ticks, 'tick').mockImplementation(fail)
    try {
      expect(() => r.run(type === 'hold' ? { type, account: 'payer', amount: 60, ref: 'rolled-back' } : { type }))
        .toThrow('failure after hold')
    } finally { handler.mockRestore() }
    expect(r.state).not.toHaveProperty('holds')
    expect(canonical({ state: r.state, events: r.events, log: r.log })).toBe(before)
  })

  it('(j) unheld pay may spend held funds and drive available negative (Q19 open)', () => {
    const r = funded()
    r.run({ type: 'hold', account: 'payer', amount: 60, ref: 'decision.1' })
    const hold = structuredClone(r.state.holds)
    r.run({ type: 'pay', from: 'payer', to: 'payee', amount: 80, kind: 'purchase' })
    expect(balanceOf(r.state, 'payer')).toBe(20)
    expect(availableOf(r.state, 'payer')).toBe(-40)
    expect(r.state.holds).toEqual(hold)
    expect(r.state.ledger.at(-1)).toMatchObject({ from: 'payer', to: 'payee', amount: 80 })
  })

  it.each(['released', 'settled'] as const)('a %s hold cannot be settled again', (status) => {
    const r = funded()
    r.run({ type: 'hold', account: 'payer', amount: 60, ref: 'decision.1' })
    if (status === 'released') r.run({ type: 'release', ref: 'decision.1' })
    else r.run({ type: 'settle', ref: 'decision.1', payee: 'payee' })
    const before = canonical(r.state)
    expect(() => r.run({ type: 'settle', ref: 'decision.1', payee: 'payee' })).toThrow(`is ${status}`)
    expect(canonical(r.state)).toBe(before)
  })

  it('default settle pays only the remainder and the hold command log replays exactly', () => {
    const r = funded()
    r.run({ type: 'hold', account: 'payer', amount: 60, ref: 'decision.1' })
    r.run({ type: 'settle', ref: 'decision.1', payee: 'payee', amount: 25 })
    r.run({ type: 'settle', ref: 'decision.1', payee: 'payee' })
    r.run({ type: 'hold', account: 'payer', amount: 10, ref: 'decision.2' })
    r.run({ type: 'release', ref: 'decision.2' })
    expect(ledger(r.state, { subject: 'decision.1' }).map((row) => row.amount)).toEqual([25, 35])
    expect(r.state.holds!['decision.1']).toMatchObject({ status: 'settled', settled: 60 })
    expect(availableOf(r.state, 'payer')).toBe(40)
    const replayed = Runner.replay(r.log, r.config, r.providers, initialState('stl.holds', 'holds'))
    expect(canonical(replayed.state)).toBe(canonical(r.state))
    expect(replayed.events).toEqual(r.events)
  })

  it('no holds key is written by ordinary runs, queries or refused holds', () => {
    const r = funded()
    r.run({ type: 'pay', from: 'payer', to: 'payee', amount: 10, kind: 'purchase' })
    r.tick()
    const before = canonical(r.state)
    expect(availableOf(r.state, 'payer')).toBe(90)
    expect(() => r.run({ type: 'hold', account: 'payer', amount: 91, ref: 'too-much' })).toThrow('exceeds available')
    expect(() => r.run({ type: 'hold', account: 'payer', amount: 1, ref: 'unknown', currency: 'unknown' }))
      .toThrow('unknown currency')
    expect(r.state).not.toHaveProperty('holds')
    expect(canonical(r.state)).toBe(before)
  })
})

describe('U29 tagged may', () => {
  it('the pure default provider permits held powers and preserves missing-power denial text', () => {
    const { r, providers, parcel } = fresh()
    expect(providers.authority).toBeUndefined()
    const office = r.run<string>({ type: 'createOffice', name: 'mayor', powers: ['permit'] })
    r.run({ type: 'appoint', office, holder: 'mayor-1' })
    const before = canonical(r.state)
    const authority = officePowersAuthority(r.state)
    expect(authority.may(office, 'permit', parcel, r.state.settlement.day)).toEqual({ kind: 'yes' })
    expect(authority.may(office, 'seize', parcel, r.state.settlement.day)).toEqual({ kind: 'no', reason: 'lacks power' })
    expect(canonical(r.state)).toBe(before)
    const permission = r.run<string>({ type: 'grantPermission', office, kind: 'build', subject: parcel })
    expect(r.state.permissions[permission].grantedBy).toBe(office)
    const clerk = r.run<string>({ type: 'createOffice', name: 'clerk', powers: [] })
    r.run({ type: 'appoint', office: clerk, holder: 'clerk-1' })
    expect(() => r.run({ type: 'grantPermission', office: clerk, kind: 'build', subject: parcel }))
      .toThrow(`office ${clerk} lacks the power 'permit'`)
  })

  it.each(['grantTitle', 'transfer', 'grantPermission', 'revokePermission'] as const)(
    '%s refuses unknown authority once without a state row, event, denial or queued command', (type) => {
      const { r, providers, parcel, title } = fresh()
      const office = r.run<string>({ type: 'createOffice', name: 'mayor', powers: ['permit', 'public-title', 'seize'] })
      r.run({ type: 'appoint', office, holder: 'mayor-1' })
      const permission = r.run<string>({ type: 'grantPermission', office, kind: 'build', subject: parcel })
      const landTitle = Object.values(r.state.titles).find((entry) => entry.subject === parcel)!.id
      r.run({ type: 'transfer', title: landTitle, to: 'none', kind: 'transfer' })
      const may = vi.fn((): AuthorityAnswer => ({ kind: 'unknown', reads: ['gov.office.holder', 'gov.law.power'] }))
      providers.authority = { may }
      const state = canonical(r.state)
      const events = canonical(r.events)
      const log = canonical(r.log)
      const commands = {
        grantTitle: { type: 'grantTitle', subject: parcel, holder: 'town', authority: office },
        transfer: { type: 'transfer', title, to: 'town', kind: 'seizure', authority: office },
        grantPermission: { type: 'grantPermission', office, kind: 'build', subject: parcel },
        revokePermission: { type: 'revokePermission', office, permission },
      } as const
      expect(() => r.run(commands[type])).toThrow('authority unresolved: gov.office.holder, gov.law.power')
      expect(may).toHaveBeenCalledTimes(1)
      expect(canonical(r.state)).toBe(state)
      expect(canonical(r.events)).toBe(events)
      expect(canonical(r.log)).toBe(log)
    })

  it.each([true, false, {}, { kind: 'invalid' }, null, undefined])('refuses an untagged answer %j', (answer) => {
    const { r, providers, parcel } = fresh()
    const office = r.run<string>({ type: 'createOffice', name: 'mayor', powers: ['permit'] })
    r.run({ type: 'appoint', office, holder: 'mayor-1' })
    providers.authority = { may: () => answer as unknown as AuthorityAnswer }
    const before = canonical({ state: r.state, events: r.events, log: r.log })
    expect(() => r.run({ type: 'grantPermission', office, kind: 'build', subject: parcel }))
      .toThrow('authority provider returned an untagged answer')
    expect(canonical({ state: r.state, events: r.events, log: r.log })).toBe(before)
  })

  it('replays thirty days without Government byte-identically', () => {
    // The Gate also compares this no-Government scenario and the pirate run to their existing goldens.
    const { r, providers } = buildHamlet()
    const rebuilt = buildHamlet()
    const from = structuredClone(r.state)
    r.log.length = 0
    r.events.length = 0
    expect(providers.authority).toBeUndefined()
    r.tick(30)
    const replayed = Runner.replay(r.log, r.config, rebuilt.providers, from)
    expect(canonical({ state: replayed.state, events: replayed.events, log: replayed.log }))
      .toBe(canonical({ state: r.state, events: r.events, log: r.log }))
  })
})

describe('U28 right of use query', () => {
  it.each([
    { name: 'title holder with an opaque household id', who: 'household.1', tenant: false, ended: false, titled: true, allowed: true },
    { name: 'active tenant', who: 'household.2', tenant: true, ended: false, titled: true, allowed: true },
    { name: 'tenant whose lease ended', who: 'household.2', tenant: true, ended: true, titled: true, allowed: false },
    { name: 'stranger', who: 'household.3', tenant: false, ended: false, titled: true, allowed: false },
    { name: 'building with no title', who: 'household.1', tenant: false, ended: false, titled: false, allowed: false },
  ])('$name: pure query agrees with the command check', ({ who, tenant, ended, titled, allowed }) => {
    const { r, bldg, title } = fresh()
    r.run({ type: 'transfer', title, to: 'household.1', kind: 'gift' })
    if (tenant) {
      const lease = r.run<string>({ type: 'lease', title, tenant: who, scope: 'whole', rent: 1 })
      if (ended) r.run({ type: 'endLease', lease })
    }
    if (!titled) r.state.titles = {}
    const before = canonical(r.state)
    expect(hasRightOfUse(r.state, who, bldg)).toBe(allowed)
    expect(canonical(r.state)).toBe(before)
    const open = () => r.run({ type: 'openBusiness', kind: 'shop', premises: [{ bldg }], operator: who, inventory: 'inv.shop' })
    if (allowed) expect(open).not.toThrow()
    else expect(open).toThrow(`${who} has no right of use over ${bldg} (no title, no lease)`)
  })

  it('uses the parcel title when no building title is held, and ignores leases on other titles', () => {
    const { r, bldg, title, parcel } = fresh()
    const parcelTitle = Object.values(r.state.titles).find((entry) => entry.subject === parcel)!
    r.run({ type: 'lease', title: parcelTitle.id, tenant: 'household.2', scope: 'whole', rent: 1 })
    expect(hasRightOfUse(r.state, 'household.2', bldg)).toBe(false)
    delete r.state.titles[title]
    const before = canonical(r.state)
    expect(hasRightOfUse(r.state, 'butcher', bldg)).toBe(true)
    expect(hasRightOfUse(r.state, 'household.2', bldg)).toBe(true)
    expect(canonical(r.state)).toBe(before)
  })
})

describe('U24 a hire reports back to the intention that asked for it (IF-27)', () => {
  it('emits one postFilled followed by one completed outcome carrying the cause and wage', () => {
    const ctx = fresh()
    const { r } = ctx
    const { p1: post } = openShop(ctx)
    const wage = r.state.posts[post].wage
    r.events.length = 0
    r.run({ type: 'hire', post, holder: 'esfp-f', cause: 'evt.intent.1' })
    const filled = { type: 'postFilled', post, holder: 'esfp-f', wage, cause: 'evt.intent.1' }
    expect(r.events).toEqual([filled, { type: 'shared.action.outcome', cause: 'evt.intent.1', status: 'completed',
      stimuli: [{ post, holder: 'esfp-f', wage }], payload: filled }])
  })

  it.each([undefined, ''])('emits postFilled without a cause key or outcome when cause is %s', (cause) => {
    const ctx = fresh()
    const { r } = ctx
    const { p1: post } = openShop(ctx)
    r.events.length = 0
    r.run({ type: 'hire', post, holder: 'esfp-f', ...(cause === undefined ? {} : { cause }) })
    expect(r.events).toEqual([{ type: 'postFilled', post, holder: 'esfp-f', wage: r.state.posts[post].wage }])
    expect(r.events[0]).not.toHaveProperty('cause')
  })

  it('emits postFilled for a pool holder on every hire', () => {
    const ctx = fresh()
    const { r } = ctx
    const { p1: post } = openShop(ctx)
    r.events.length = 0
    for (let i = 0; i < 2; i++) r.run({ type: 'hire', post, holder: 'pool.housing' })
    const filled = { type: 'postFilled', post, holder: 'pool.housing', wage: r.state.posts[post].wage }
    expect(r.events).toEqual([filled, filled])
  })

  it('an unknown post throws without emitting either event or changing state or log', () => {
    const ctx = fresh()
    const { r } = ctx
    openShop(ctx)
    r.events.length = 0
    const before = structuredClone(r.state)
    const log = structuredClone(r.log)
    expect(() => r.run({ type: 'hire', post: 'post.unknown', holder: 'esfp-f', cause: 'evt.intent.1' })).toThrow(/unknown post/)
    expect(r.events).toEqual([])
    expect(r.state).toEqual(before)
    expect(r.log).toEqual(log)
  })

  it('replays the hire log with identical state and events', () => {
    const ctx = fresh()
    const { r } = ctx
    const { p1, p2 } = openShop(ctx)
    const from = structuredClone(r.state)
    const rebuilt = fresh()
    openShop(rebuilt)
    r.log.length = 0
    r.events.length = 0
    r.run({ type: 'hire', post: p1, holder: 'esfp-f', cause: 'evt.intent.1' })
    r.run({ type: 'hire', post: p2, holder: 'pool.housing', cause: 'evt.intent.2' })
    r.run({ type: 'hire', post: p1, holder: 'butcher' })
    const log = structuredClone(r.log)
    const replayed = Runner.replay(log, r.config, rebuilt.providers, from)
    expect(replayed.state).toEqual(r.state)
    expect(replayed.events).toEqual(r.events)
    expect(replayed.log).toEqual(log)
  })
})

describe('U1 ids are stable and never reused', () => {
  it('replays mint the same ids; a retired parent stays queryable', () => {
    const a = fresh()
    const big = a.r.run<string>({ type: 'addParcel', district: a.dist, footprint: { x: 20, y: 0, w: 20, h: 10 } })
    a.r.run({ type: 'grantTitle', subject: big, holder: 'town' })
    const kids = a.r.run<string[]>({ type: 'splitParcel', parcel: big, children: [{ x: 20, y: 0, w: 10, h: 10 }, { x: 30, y: 0, w: 10, h: 10 }] })
    const grand = a.r.run<string[]>({ type: 'splitParcel', parcel: kids[0], children: [{ x: 20, y: 0, w: 5, h: 10 }, { x: 25, y: 0, w: 5, h: 10 }] })
    const demolish = a.r.run<string>({ type: 'startProject', kind: 'demolish', target: a.bldg, account: 'butcher', labourHours: 0 })
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
    ctx.r.run({ type: 'startProject', kind: 'renovate', target: ctx.bldg, account: 'butcher', labourHours: 0,
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
      ctx.r.run({ type: 'startProject', kind: 'renovate', target: ctx.bldg, account: 'butcher', labourHours: 0,
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
    const proj = ctx.r.run<string>({ type: 'startProject', kind: 'renovate', target: ctx.bldg, account: 'butcher', pool: 'pool.builders', wage: 1, labourHours: 20,
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
    const cancelled = ctx.r.run<string>({ type: 'startProject', kind: 'renovate', target: ctx.bldg, account: 'butcher', labourHours: 50, plan: { addFixtures: ['oven'] } })
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
    const demolish = ctx.r.run<string>({ type: 'startProject', kind: 'demolish', target: ctx.bldg, account: 'butcher', labourHours: 0 })
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
    const proj = ctx.r.run<string>({ type: 'startProject', kind: 'construct', target: site, account: 'town', pool: 'pool.housing', labourHours: 10, permitRequired: true,
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

describe('U22 office powers go through the AuthorityProvider (GOVERNMENT-SETTLEMENT §2, §7)', () => {
  it('defaults to powers for a permit grant and a missing-power refusal', () => {
    const { r, providers, parcel } = fresh()
    expect(providers.authority).toBeUndefined()
    const mayor = r.run<string>({ type: 'createOffice', name: 'mayor', powers: ['permit'] })
    const clerk = r.run<string>({ type: 'createOffice', name: 'clerk', powers: [] })
    r.run({ type: 'appoint', office: mayor, holder: 'estj-f' })
    r.run({ type: 'appoint', office: clerk, holder: 'clerk-1' })
    expect(() => r.run({ type: 'grantPermission', office: clerk, kind: 'build', subject: parcel }))
      .toThrow(`office ${clerk} lacks the power 'permit'`)
    const permit = r.run<string>({ type: 'grantPermission', office: mayor, kind: 'build', subject: parcel })
    expect(r.state.permissions[permit].grantedBy).toBe(mayor)
    expect(ledger(r.state, { kind: 'permit' })).toHaveLength(1)
  })

  it('a provider refusal overrides permit powers without adding a permission or ledger row', () => {
    const { r, providers, parcel } = fresh()
    const mayor = r.run<string>({ type: 'createOffice', name: 'mayor', powers: ['permit'] })
    r.run({ type: 'appoint', office: mayor, holder: 'estj-f' })
    providers.authority = { may: () => ({ kind: 'no', reason: 'lacks power' }) }
    const before = structuredClone(r.state)
    expect(() => r.run({ type: 'grantPermission', office: mayor, kind: 'build', subject: parcel }))
      .toThrow(`office ${mayor} lacks the power 'permit'`)
    expect(r.state.permissions).toEqual(before.permissions)
    expect(r.state.ledger).toEqual(before.ledger)
  })

  it('a provider approval permits an office without the permit power', () => {
    const { r, providers, parcel } = fresh()
    const clerk = r.run<string>({ type: 'createOffice', name: 'clerk', powers: [] })
    r.run({ type: 'appoint', office: clerk, holder: 'clerk-1' })
    providers.authority = { may: () => ({ kind: 'yes' }) }
    const permit = r.run<string>({ type: 'grantPermission', office: clerk, kind: 'build', subject: parcel })
    expect(r.state.permissions[permit].grantedBy).toBe(clerk)
  })

  it('asks once with the office, power, null subject and current day', () => {
    const { r, providers } = fresh()
    const mayor = r.run<string>({ type: 'createOffice', name: 'mayor', powers: ['permit'] })
    r.run({ type: 'appoint', office: mayor, holder: 'estj-f' })
    const may = vi.fn((): AuthorityAnswer => ({ kind: 'yes' }))
    providers.authority = { may }
    const ctx: Ctx = { state: r.state, config: r.config, providers, events: [], staffed: new Set() }
    officeHas(ctx, mayor, 'permit')
    expect(may).toHaveBeenCalledExactlyOnceWith(mayor, 'permit', null, r.state.settlement.day)
  })

  it('rejects vacant, null and unknown offices before asking the provider', () => {
    const { r, providers, parcel } = fresh()
    const mayor = r.run<string>({ type: 'createOffice', name: 'mayor', powers: ['permit'] })
    const may = vi.fn((): AuthorityAnswer => ({ kind: 'yes' }))
    providers.authority = { may }
    expect(() => r.run({ type: 'grantPermission', office: mayor, kind: 'build', subject: parcel }))
      .toThrow(`office is vacant: ${mayor}`)
    const ctx: Ctx = { state: r.state, config: r.config, providers, events: [], staffed: new Set() }
    expect(() => officeHas(ctx, null, 'permit')).toThrow("an office with the power 'permit' is required")
    expect(() => officeHas(ctx, 'missing', 'permit')).toThrow(/office/)
    expect(may).not.toHaveBeenCalled()
  })
})

describe('U23 the AuthorityProvider gets the land subject (GOVERNMENT-SETTLEMENT §2)', () => {
  function setup() {
    const ctx = fresh()
    const office = ctx.r.run<string>({ type: 'createOffice', name: 'mayor', powers: [] })
    ctx.r.run({ type: 'appoint', office, holder: 'estj-f' })
    const may = vi.fn((): AuthorityAnswer => ({ kind: 'yes' }))
    ctx.providers.authority = { may }
    return { ...ctx, office, may }
  }

  it('re-granting a vacated title asks about its parcel', () => {
    const { r, parcel, office, may } = setup()
    const title = Object.values(r.state.titles).find((entry) => entry.subject === parcel)!.id
    r.run({ type: 'transfer', title, to: 'none', kind: 'transfer' })
    r.run({ type: 'grantTitle', subject: parcel, holder: 'town', authority: office })
    expect(may).toHaveBeenCalledExactlyOnceWith(office, 'public-title', parcel, r.state.settlement.day)
  })

  it('a seizure asks about the title subject, not the title id', () => {
    const { r, title, bldg, office, may } = setup()
    r.run({ type: 'transfer', title, to: 'town', kind: 'seizure', authority: office })
    expect(may).toHaveBeenCalledExactlyOnceWith(office, 'seize', bldg, r.state.settlement.day)
  })

  it('granting a permission asks about the command subject', () => {
    const { r, parcel, office, may } = setup()
    r.run({ type: 'grantPermission', office, kind: 'build', subject: parcel })
    expect(may).toHaveBeenCalledExactlyOnceWith(office, 'permit', parcel, r.state.settlement.day)
  })

  it('revoking a permission asks about the recorded subject', () => {
    const { r, bldg, office, may } = setup()
    const permission = r.run<string>({ type: 'grantPermission', office, kind: 'build', subject: bldg })
    may.mockClear()
    r.run({ type: 'revokePermission', office, permission })
    expect(may).toHaveBeenCalledExactlyOnceWith(office, 'permit', bldg, r.state.settlement.day)
    expect(r.state.permissions[permission].status).toBe('revoked')
  })

  it('a missing permission passes null and still checks the office first', () => {
    const { r, providers, office, may } = setup()
    expect(() => r.run({ type: 'revokePermission', office, permission: 'missing' })).toThrow(/permission/)
    expect(may).toHaveBeenCalledExactlyOnceWith(office, 'permit', null, r.state.settlement.day)
    providers.authority = { may: () => ({ kind: 'no', reason: 'lacks power' }) }
    expect(() => r.run({ type: 'revokePermission', office, permission: 'missing' })).toThrow(/lacks the power/)
  })

  it('the same office can be refused on one subject and allowed on another', () => {
    const { r, providers, parcel, bldg, office } = setup()
    const may = vi.fn((_office: string, _power: string, subject: string | null): AuthorityAnswer =>
      subject !== parcel ? { kind: 'yes' } : { kind: 'no', reason: 'lacks power' })
    providers.authority = { may }
    const before = structuredClone(r.state)
    expect(() => r.run({ type: 'grantPermission', office, kind: 'build', subject: parcel })).toThrow(/lacks the power/)
    expect(r.state).toEqual(before)
    const permission = r.run<string>({ type: 'grantPermission', office, kind: 'build', subject: bldg })
    expect(r.state.permissions[permission].subject).toBe(bldg)
    expect(may.mock.calls.map((call) => call[2])).toEqual([parcel, bldg])
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

describe('U15 replay rebuilds the hamlet and A1 with the host providers', () => {
  it('replays commands and three ticks with identical state, events and command results', () => {
    function buildA1() {
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
      r.run({ type: 'sell', title, buyer: 'player', price: providers.prices.valueOf(bldg, r.state.settlement.day) })
      r.tick()
      r.run({ type: 'transfer', title, to: 'farm-son', kind: 'gift' })
      r.tick()
      r.run({ type: 'lease', title, tenant: 'esfp-f', scope: ['shop'], rent: 2 })
      const biz = r.run<string>({ type: 'openBusiness', kind: 'butcher', premises: [{ bldg, rooms: ['shop'] }],
        operator: 'esfp-f', manager: 'farm-son', inventory: 'inv.butcher',
        lines: [{ recipe: 'salt-meat', equipment: ['salting-house'] }, { recipe: 'smoked-meat', equipment: ['smokehouse'] }] })
      r.run({ type: 'assign', person: 'farm-son', kind: 'management', target: biz })
      r.run({ type: 'credit', holder: biz, amount: 100 })
      r.tick()
      const p1 = r.run<string>({ type: 'addPost', biz, role: 'butcher', wage: 2 })
      const p2 = r.run<string>({ type: 'addPost', biz, role: 'labourer', wage: 1 })
      r.run({ type: 'hire', post: p1, holder: 'esfp-f' })
      r.run({ type: 'hire', post: p2, holder: 'pool.housing' })
      r.tick()
      providers.labour.pools['pool.builders'] = 1
      providers.materials.set('esfp-f', 'timber', 10)
      r.run({ type: 'startProject', kind: 'renovate', target: bldg, account: 'esfp-f', pool: 'pool.builders', wage: 1, labourHours: 20,
        materials: [{ material: 'timber', units: 5 }],
        plan: { rooms: [{ id: 'back', name: 'back room', tiles: { x: 1, y: 5, w: 8, h: 2 }, use: 'smoke' }],
          addFixtures: ['smokehouse'], placements: [{ fixture: 'smokehouse', room: 'back', at: { x: 2, y: 5 } }] } })
      r.tick(2)
      providers.materials.set('inv.butcher', 'meat', 100)
      providers.materials.set('inv.butcher', 'salt', 100)
      return { r, providers }
    }

    for (const build of [buildHamlet, buildA1]) {
      const { r, providers } = build()
      const from = structuredClone(r.state)
      const fromBefore = structuredClone(from)
      // Host setup writes stores outside the log. Rebuild it at the same boundary,
      // before any of the three ticks consumes those stores.
      const rebuilt = build()
      r.log.length = 0
      r.events.length = 0
      const district = r.run<string>({ type: 'addDistrict', name: 'extension', kind: 'housing', bounds: { x: 60, y: 0, w: 10, h: 10 } })
      expect(r.state.districts[district].name).toBe('extension')
      r.tick(3)
      const log = structuredClone(r.log)
      const replayed = Runner.replay(log, r.config, rebuilt.providers, from)
      expect(replayed).toBeInstanceOf(Runner)
      expect(replayed.state).toEqual(r.state)
      expect(replayed.events).toEqual(r.events)
      expect(replayed.log).toEqual(log)
      expect(rebuilt.providers.materials.stock).toEqual(providers.materials.stock)
      expect(from).toEqual(fromBefore)
      expect(log).toEqual(r.log)
    }
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
    const proj = r.run<string>({ type: 'startProject', kind: 'construct', target: parcel, account: 'butcher', inventory: 'inv.yard', pool: 'pool.housing', wage: 1, labourHours: 10,
      materials: [{ material: 'timber', units: 10 }], plan: { footprint: { x: 21, y: 1, w: 4, h: 4 }, rooms: [{ id: 'hut', name: 'hut', tiles: { x: 21, y: 1, w: 4, h: 4 }, use: 'living' }] } })
    expect(r.state.projects[proj].inventory).toBe('inv.yard')
    r.tick()
    expect(r.state.projects[proj].status).toBe('done')
    expect(providers.materials.get('inv.yard', 'timber')).toBe(0)
    expect(providers.materials.get('butcher', 'timber')).toBe(0)
    const wage = r.state.ledger.slice(before).find((row) => row.subject === proj && row.kind === 'wage')!
    expect(wage.from).toBe('butcher')
    const legacy = r.run<string>({ type: 'startProject', kind: 'repair', target: ctx.bldg, account: 'butcher', pool: 'pool.housing', labourHours: 10 })
    expect(r.state.projects[legacy].inventory).toBe('butcher')   // the default keeps old callers working; the record no longer conflates the two
  })
})

describe('U21 one status writer, one event per change (SET-21, REG-16)', () => {
  it('the hamlet emits one businessStatusChanged in ten days; losing the only worker on day 5 emits one more', () => {
    const { r, ids } = buildHamlet()
    r.events.length = 0
    const changes = () => r.events.filter((event) => event.type === 'businessStatusChanged' && event.biz === ids.biz)
    r.tick(4)
    expect(changes()).toHaveLength(1)
    expect(r.state.businesses[ids.biz].status).toBe('producing')
    r.run({ type: 'dismiss', post: ids.post })
    r.tick(6)
    expect(changes()).toHaveLength(2)
    expect(r.state.businesses[ids.biz].status).toBe('dormant')
    expect(r.state.production[ids.biz]).toBeUndefined()
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


describe('U17 setWage is the only channel for a wage level', () => {
  it('Post.wage never moves in a tick, each wage row equals it, and setWage changes the next row', () => {
    const ctx = fresh()
    const { r } = ctx
    const { p1 } = openShop(ctx)
    r.run({ type: 'hire', post: p1, holder: 'butcher' })
    const rows = () => ledger(r.state, { kind: 'wage', subject: p1 }).map((row) => row.amount)
    for (let day = 0; day < 10; day++) {
      const wage = r.state.posts[p1].wage
      const paid = rows().length
      r.tick()
      expect(r.state.posts[p1].wage).toBe(wage)
      expect(rows().slice(paid)).toEqual([wage])
    }
    r.run({ type: 'setWage', post: p1, wage: 5 })
    expect(r.state.posts[p1].wage).toBe(5)
    const paid = rows().length
    r.tick()
    expect(rows().slice(paid)).toEqual([5])
  })
  it('only addPost and setWage write a wage in the command and tick sources', async () => {
    // the package has no node typings, so the module name is a variable
    const specifier = 'node:fs'
    const { readFileSync, readdirSync } = await import(/* @vite-ignore */ specifier) as {
      readFileSync(file: string, encoding: string): string
      readdirSync(dir: string): string[]
    }
    const files = ['src/commands.ts', ...readdirSync('src/tick').map((name) => `src/tick/${name}`)]
    const sites = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
      return [...source.matchAll(/\.wage\s*=[^=]|\bwage:\s*finite\(c\.wage,/g)].map((match) => {
        let functionName: string | undefined
        const visit = (node: ts.Node): void => {
          if (match.index < node.getStart(parsed) || match.index >= node.end) return
          if (ts.isFunctionLike(node)) {
            functionName = ts.isFunctionDeclaration(node) ? node.name?.text : undefined
          }
          ts.forEachChild(node, visit)
        }
        visit(parsed)
        return { file, functionName }
      })
    })
    expect(sites).toEqual([
      { file: 'src/commands.ts', functionName: 'addPost' },
      { file: 'src/commands.ts', functionName: 'setWage' },
    ])
  })
})

describe('U18 finite pool hours are shared across businesses and projects', () => {
  it('grants at most the daily supply across roles and uses partial grants in caps', () => {
    const ctx = fresh()
    const { r, providers } = ctx
    providers.labour.pools['pool.housing'] = 3.5
    const businesses = [openShop(ctx), openShop(ctx)]
    for (const { p1, p2 } of businesses) {
      r.run({ type: 'hire', post: p1, holder: 'pool.housing' })
      r.run({ type: 'hire', post: p2, holder: 'pool.housing' })
    }
    r.run({ type: 'removePost', post: businesses[1].p2 })
    providers.materials.set('inv.shop', 'meat', 100)
    providers.materials.set('inv.shop', 'salt', 100)
    const project = r.run<string>({ type: 'startProject', kind: 'repair', target: ctx.bldg,
      account: 'butcher', pool: 'pool.housing', labourHours: 10, wage: 1 })
    const day = r.state.settlement.day
    r.tick()
    const caps = businesses.map(({ biz }) => r.state.production[biz].lines[0].caps.labour)
    expect(caps).toEqual([8, 2])
    const granted = providers.labour.grants.filter((row) => row.day === day).reduce((sum, row) => sum + row.hours, 0)
    expect(granted).toBe(35)
    expect(caps.reduce((sum, cap) => sum + cap * 2.5, 0) + r.state.projects[project].progress).toBe(granted)
    expect(providers.labour.hours('pool.housing', 'other-role', day)).toBe(0)
    expect(providers.labour.draw('pool.housing', 'other-role', null, 10, day)).toBe(0)
    expect(providers.labour.hours('pool.housing', 'butcher', day + 1)).toBe(35)
    expect(providers.labour.supply(day)).toEqual([{ category: 'pool.housing', persons: 3.5, personHours: 35 }])
  })
  it('uses the host day length, keeps the alias and caps named assignments across posts', () => {
    const stub = new StubLabour(8)
    expect(stub).toBeInstanceOf(StubLabourSupply)
    stub.pools.crew = 2
    expect(stub.draw('crew', 'sawyer', null, 12, 0)).toBe(12)
    expect(stub.draw('crew', 'builder', null, 12, 0)).toBe(4)
    expect(stub.draw('missing', 'builder', null, 12, 0)).toBe(0)
    const ctx = fresh()
    const { biz, p1, p2 } = openShop(ctx)
    ctx.providers.labour.hours = () => 15
    for (const post of [p1, p2]) ctx.r.run({ type: 'hire', post, holder: 'worker' })
    ctx.r.tick()
    expect(ctx.r.state.production[biz].lines[0].caps.labour).toBe(6)
  })
  it('rejects an undecided sharing rule with Q15', () => {
    const { r } = fresh()
    r.config.labourSharing = 'finite-hours'
    expect(() => r.tick()).toThrow('open for Rex (Q15): labourSharing finite-hours')
  })
})

describe('U19 person-hours preserve production, wages and project results', () => {
  it('retains U7/U8/U13/U16 and A1 numbers, including in-order lines', () => {
    const ctx = fresh()
    const { r, providers } = ctx
    const { biz, p1, p2 } = openShop(ctx)
    r.run({ type: 'hire', post: p1, holder: 'butcher' })
    r.run({ type: 'hire', post: p2, holder: 'pool.housing' })
    providers.materials.set('inv.shop', 'meat', 100)
    providers.materials.set('inv.shop', 'salt', 100)
    providers.labour.pools['pool.builders'] = 1
    const project = r.run<string>({ type: 'startProject', kind: 'renovate', target: ctx.bldg,
      account: 'butcher', pool: 'pool.builders', labourHours: 20, wage: 1, plan: { addFixtures: ['smokehouse'] } })
    r.tick()
    expect(r.state.projects[project].status).toBe('active')
    expect(r.state.production[biz].lines[0].q).toBe(8)
    r.tick()
    expect(r.state.projects[project].status).toBe('done')
    expect(r.state.buildings[ctx.bldg].layout.version).toBe(2)
    expect(ledger(r.state, { kind: 'wage', subject: project }).map((row) => row.amount)).toEqual([1, 1])
    expect(ledger(r.state, { kind: 'wage', subject: p1 }).map((row) => row.amount)).toEqual([2, 2])
    expect(ledger(r.state, { kind: 'wage', subject: p2 }).map((row) => row.amount)).toEqual([1, 1])
    r.run({ type: 'setLines', biz, lines: [{ recipe: 'salt-meat', equipment: ['salting-house'] }, { recipe: 'smoked-meat', equipment: ['smokehouse'] }] })
    r.tick()
    expect(r.state.production[biz].lines.map((line) => line.q)).toEqual([8, 0])
    providers.materials.recipes['salt-meat'].unitsPerFixtureDay = 3
    r.tick()
    expect(r.state.production[biz].lines[0].q).toBe(3)
  })
  it('converts explicit worker-day advances to hours and prorates fractional project draws', () => {
    const { r, providers, bldg } = fresh()
    const project = r.run<string>({ type: 'startProject', kind: 'repair', target: bldg,
      account: 'butcher', pool: 'pool.builders', labourHours: 15, wage: 2 })
    r.run({ type: 'advanceProject', project, workerDays: 1 })
    expect(r.state.projects[project].progress).toBe(10)
    providers.labour.pools['pool.builders'] = 1
    r.tick()
    expect(r.state.projects[project].progress).toBe(15)
    expect(r.state.projects[project].status).toBe('done')
    expect(ledger(r.state, { kind: 'wage', subject: project }).map((row) => row.amount)).toEqual([2, 1])
  })
  it('preserves the hamlet five-day output and wages', () => {
    const { r, providers, ids } = buildHamlet()
    r.tick(5)
    expect(providers.materials.get('inv.sawyer', 'plank')).toBe(40)
    expect(r.state.production[ids.biz].lines[0].q).toBe(2)
    expect(balanceOf(r.state, ids.biz)).toBe(40)
    expect(balanceOf(r.state, 'alder')).toBe(96)
  })
})

describe('U20 setInventory rebinds a business inventory', () => {
  it('the next tick uses the new ref and rejects missing businesses or empty refs atomically', () => {
    const ctx = fresh()
    const { r, providers } = ctx
    const { biz, p1, p2 } = openShop(ctx)
    for (const post of [p1, p2]) r.run({ type: 'hire', post, holder: 'pool.housing' })
    for (const inventory of ['inv.shop', 'inv.new']) {
      providers.materials.set(inventory, 'meat', 10)
      providers.materials.set(inventory, 'salt', 10)
    }
    r.run({ type: 'setInventory', biz, inventory: 'inv.new' })
    r.tick()
    expect(r.state.businesses[biz].inventory).toBe('inv.new')
    expect(providers.materials.get('inv.new', 'salt-meat')).toBe(8)
    expect(providers.materials.get('inv.shop', 'meat')).toBe(10)
    const before = structuredClone(r.state)
    expect(() => r.run({ type: 'setInventory', biz, inventory: '' })).toThrow()
    expect(() => r.run({ type: 'setInventory', biz: 'missing', inventory: 'inv.new' })).toThrow()
    expect(r.state).toEqual(before)
  })
})
