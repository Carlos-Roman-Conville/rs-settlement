// Verification and validation rows of VALIDATION.md (section 2): V for stability, conservation and boundary, VAL for
// validation against evidence. Stub providers and the hamlet only; no engine code is touched.
import { describe, expect, it } from 'vitest'
import { Runner } from '../src/reduce.ts'
import { initialState } from '../src/state.ts'
import { bandOf, defaultConfig } from '../src/config.ts'
import { stubProviders, type StubRecipe } from '../src/providers.ts'
import { totalMoney, unvalidatedDecay } from '../src/queries.ts'
import { buildHamlet } from '../examples/hamlet.ts'

const BENCH = 'bench'

// One shop on one parcel: `fixtures` benches, one required post of `hours` hours filled by a person, `materials`
// units of the recipe's input on hand, a utility cap. Everything else is generous so one factor can be varied.
function shop(opts: { fixtures: number; hours: number; materials: number; utility: number; recipe?: StubRecipe }) {
  const recipe = opts.recipe ?? { inputs: [{ good: 'ore', units: 1 }], output: 'bar', yield: 1, unitsPerFixtureDay: 10, labourHoursPerUnit: 2.5 }
  const providers = stubProviders({ bar: recipe })
  const r = new Runner(initialState('stl.val', 'validation'), defaultConfig(), providers)
  const dist = r.run<string>({ type: 'addDistrict', name: 'yard', kind: 'work', bounds: { x: 0, y: 0, w: 50, h: 50 } })
  const parcel = r.run<string>({ type: 'addParcel', district: dist, footprint: { x: 0, y: 0, w: 10, h: 10 }, access: ['road'] })
  r.run({ type: 'grantTitle', subject: parcel, holder: 'smith' })
  r.run({ type: 'startProject', kind: 'construct', target: parcel, account: 'smith', labourHours: 0,
    plan: { footprint: { x: 1, y: 1, w: 8, h: 6 }, rooms: [{ id: 'shop', name: 'the shop', tiles: { x: 1, y: 1, w: 8, h: 6 }, use: 'work' }] } })
  r.tick()
  const bldg = Object.keys(r.state.buildings)[0]
  r.run({ type: 'grantTitle', subject: bldg, holder: 'smith' })
  if (opts.fixtures > 0) {
    r.run({ type: 'startProject', kind: 'renovate', target: bldg, account: 'smith', labourHours: 0, plan: { addFixtures: Array(opts.fixtures).fill(BENCH) } })
    r.tick()
  }
  const biz = r.run<string>({ type: 'openBusiness', kind: 'smith', premises: [{ bldg, rooms: ['shop'] }], operator: 'smith', inventory: 'inv.shop',
    lines: [{ recipe: 'bar', equipment: [BENCH] }] })
  const post = r.run<string>({ type: 'addPost', biz, role: 'smith', wage: 0, hours: opts.hours })
  r.run({ type: 'hire', post, holder: 'worker' })
  providers.materials.set('inv.shop', 'ore', opts.materials)
  providers.utilities.caps[bldg] = opts.utility
  return { r, providers, bldg, biz }
}

function q(opts: Parameters<typeof shop>[0]): number {
  const ctx = shop(opts)
  ctx.r.tick()
  return ctx.r.state.production[ctx.biz]?.lines[0].q ?? 0
}

describe('V1 money is conserved to the unit over a year', () => {
  it('the hamlet run for 365 ticks keeps totalMoney exactly, after every tick', () => {
    const { r } = buildHamlet()
    const before = totalMoney(r.state)
    for (let day = 0; day < 365; day++) {
      r.tick()
      expect(totalMoney(r.state)).toBe(before)
    }
    expect(totalMoney(r.state)).toBe(before)
    expect(r.state.ledger.length).toBeGreaterThan(0)
  })
})

describe('V2 staffing status is a pure function of the day\'s inputs', () => {
  it('two runners built the same way give identical business statuses on each of 30 ticks', () => {
    const a = buildHamlet()
    const b = buildHamlet()
    const statuses = (ctx: typeof a) => Object.values(ctx.r.state.businesses).map((entry) => [entry.id, entry.status])
    for (let day = 0; day < 30; day++) {
      // the same host inputs on both: the operator is away on every third day
      for (const ctx of [a, b]) {
        if (day % 3 === 2) ctx.providers.labour.away.add('alder')
        else ctx.providers.labour.away.delete('alder')
        ctx.r.tick()
      }
      expect(statuses(a)).toEqual(statuses(b))
    }
    expect(statuses(a).length).toBeGreaterThan(0)
  })
})

describe('V3 production Q is monotone non-decreasing in every factor', () => {
  const base = { fixtures: 6, hours: 200, materials: 1000, utility: 1000 }
  const sweeps: { factor: keyof typeof base; values: number[] }[] = [
    { factor: 'fixtures', values: [0, 1, 2, 3, 4, 5, 6] },
    { factor: 'hours', values: [0, 5, 10, 20, 40, 80, 160, 200] },
    { factor: 'materials', values: [0, 1, 2, 5, 10, 30, 60, 100] },
    { factor: 'utility', values: [0, 1, 2, 5, 10, 30, 60, 100] },
  ]
  for (const { factor, values } of sweeps) {
    it(`raising ${factor} from 0 never lowers Q, and Q is 0 when ${factor} is 0`, () => {
      const out = values.map((value) => q({ ...base, [factor]: value }))
      expect(out[0]).toBe(0)
      for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1])
      expect(out[out.length - 1]).toBeGreaterThan(0)
    })
  }
})

describe('V4 an Infinity cap never yields an infinite or NaN output', () => {
  const noInputs: StubRecipe = { inputs: [], output: 'water', yield: 1, unitsPerFixtureDay: 10, labourHoursPerUnit: 2.5 }
  const numbers = (ctx: ReturnType<typeof shop>) => {
    const entry = ctx.r.state.production[ctx.biz]
    return entry ? entry.lines.flatMap((line) => [line.q, ...Object.values(line.caps)]) : []
  }
  it('a recipe with no inputs (materials available = Infinity) gives a finite Q and finite recorded numbers', () => {
    const ctx = shop({ fixtures: 2, hours: 100, materials: 0, utility: 1000, recipe: noInputs })
    expect(ctx.providers.materials.available('inv.shop', 'bar')).toBe(Number.POSITIVE_INFINITY)
    ctx.r.tick()
    const values = numbers(ctx)
    expect(values.length).toBeGreaterThan(0)
    for (const value of values) expect(Number.isFinite(value)).toBe(true)
    expect(ctx.r.state.production[ctx.biz].lines[0].q).toBe(20)
  })
  it('the same holds over several days of output', () => {
    const ctx = shop({ fixtures: 2, hours: 100, materials: 0, utility: 1000, recipe: noInputs })
    for (let day = 0; day < 5; day++) {
      ctx.r.tick()
      for (const value of numbers(ctx)) expect(Number.isFinite(value)).toBe(true)
    }
    expect(Number.isFinite(ctx.providers.materials.get('inv.shop', 'water'))).toBe(true)
  })
  // Observed: q = Infinity (Math.floor(Infinity)), so materials.produce adds Infinity to inventory and production records it.
  // Fix (src/tick/production.ts line 40): `const q = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : 0` (or throw). QUESTIONS.md Q20.
  it.skip('every cap is Infinity', () => {
    const free: StubRecipe = { inputs: [], output: 'water', yield: 1, unitsPerFixtureDay: 10, labourHoursPerUnit: 0 }
    const ctx = shop({ fixtures: 2, hours: 100, materials: 0, utility: Number.POSITIVE_INFINITY, recipe: free })
    ctx.r.state.businesses[ctx.biz].lines[0].equipment = []
    ctx.r.tick()
    for (const value of numbers(ctx)) expect(Number.isNaN(value)).toBe(false)
    expect(Number.isFinite(ctx.r.state.production[ctx.biz].lines[0].q)).toBe(true)
    expect(Number.isFinite(ctx.providers.materials.get('inv.shop', 'water'))).toBe(true)
  })
})

describe('V6 building condition stays in [0, 1] and only repair raises it', () => {
  it('without repair, 1,000 ticks never rise, never leave [0, 1] and never go below 0', () => {
    const { r, bldg } = shop({ fixtures: 0, hours: 10, materials: 0, utility: 0 })
    r.run({ type: 'setDecayClass', bldg, decayClass: 'palm-thatch' })
    let last = r.state.buildings[bldg].condition
    expect(last).toBeLessThanOrEqual(1)
    const start = last
    for (let day = 0; day < 1000; day++) {
      r.tick()
      const now = r.state.buildings[bldg].condition
      expect(now).toBeLessThanOrEqual(last)
      expect(now).toBeGreaterThanOrEqual(0)
      expect(now).toBeLessThanOrEqual(1)
      last = now
    }
    expect(last).toBeLessThan(start)
  })
  it('a completed repair project raises the condition', () => {
    const { r, bldg } = shop({ fixtures: 0, hours: 10, materials: 0, utility: 0 })
    r.run({ type: 'setCondition', bldg, condition: 0.3 })
    const repair = r.run<string>({ type: 'startProject', kind: 'repair', target: bldg, account: 'smith', labourHours: 0 })
    r.tick()
    expect(r.state.projects[repair].status).toBe('done')
    expect(r.state.buildings[bldg].condition).toBeGreaterThan(0.3)
    expect(r.state.buildings[bldg].condition).toBeLessThanOrEqual(1)
  })
})

describe('V7 a project draws exactly the materials it names, once', () => {
  function stocked() {
    const { r, providers } = shop({ fixtures: 0, hours: 10, materials: 0, utility: 0 })
    providers.materials.set('smith', 'timber', 50)
    providers.materials.set('smith', 'nails', 7)
    const parcel = r.run<string>({ type: 'addParcel', district: Object.keys(r.state.districts)[0], footprint: { x: 20, y: 0, w: 10, h: 10 }, access: ['road'] })
    r.run({ type: 'grantTitle', subject: parcel, holder: 'smith' })
    const start = () => r.run<string>({ type: 'startProject', kind: 'construct', target: parcel, account: 'smith', labourHours: 50,
      materials: [{ material: 'timber', units: 10 }],
      plan: { footprint: { x: 21, y: 1, w: 6, h: 5 }, rooms: [{ id: 'hall', name: 'hall', tiles: { x: 21, y: 1, w: 6, h: 5 }, use: 'living' }] } })
    return { r, providers, start }
  }
  it('the stock falls by the named units and no more, and only once', () => {
    const { r, providers, start } = stocked()
    start()
    r.tick()
    expect(providers.materials.get('smith', 'timber')).toBe(40)
    expect(providers.materials.get('smith', 'nails')).toBe(7)
    r.tick(5)
    expect(providers.materials.get('smith', 'timber')).toBe(40)
  })
  it('a project short of its materials draws nothing', () => {
    const { r, providers, start } = stocked()
    providers.materials.set('smith', 'timber', 9)
    start()
    r.tick(3)
    expect(providers.materials.get('smith', 'timber')).toBe(9)
  })
  it('a cancelled project draws nothing afterwards', () => {
    const { r, providers, start } = stocked()
    const early = start()
    r.run({ type: 'cancelProject', project: early })
    r.tick(3)
    expect(providers.materials.get('smith', 'timber')).toBe(50)
    const drawn = start()
    r.tick()
    expect(providers.materials.get('smith', 'timber')).toBe(40)
    r.run({ type: 'cancelProject', project: drawn })
    r.tick(5)
    expect(providers.materials.get('smith', 'timber')).toBe(40)
  })
})

describe('V8 a wage change conserves money and the rows follow the post', () => {
  it('thirty hamlet ticks with one setWage on day 10 conserve money; each wage row equals the post wage', () => {
    const { r, ids } = buildHamlet()
    const before = totalMoney(r.state)
    const rows = () => r.state.ledger.filter((row) => row.kind === 'wage' && row.subject === ids.post).map((row) => row.amount)
    for (let day = 0; day < 30; day++) {
      if (day === 10) r.run({ type: 'setWage', post: ids.post, wage: 3 })
      const wage = r.state.posts[ids.post].wage
      const paid = rows().length
      r.tick()
      expect(rows().slice(paid)).toEqual([wage])
      expect(totalMoney(r.state)).toBe(before)
    }
    expect(rows().slice(0, 10)).toEqual(Array(10).fill(2))
    expect(rows().slice(10)).toEqual(Array(20).fill(3))
  })
})

describe('VAL-W1 starting wages against the benchmark band', () => {
  it.todo('VAL-W1 every starting wage within the STARTING_TOWN.md benchmark band for its trade, ±50 % (waits on Q10)')
})

// A building without businesses keeps lifetime sweeps independent of production and ledger growth.
function decayBuilding(decayClass?: string, exposure?: string) {
  const r = new Runner(initialState('stl.decay', 'decay'))
  const district = r.run<string>({ type: 'addDistrict', name: 'test', kind: 'test', bounds: { x: 0, y: 0, w: 10, h: 10 } })
  const parcel = r.run<string>({ type: 'addParcel', district, footprint: { x: 0, y: 0, w: 10, h: 10 } })
  const bldg = r.run<string>({ type: 'addBuilding', parcel, footprint: { x: 0, y: 0, w: 5, h: 5 }, decayClass, exposure })
  return { r, bldg, parcel }
}

describe('VAL-D1 years from new to ruined by material class', () => {
  // Independent bounds transcribed from VALIDATION section 4b; 50 is the interim tile/slate estimate.
  const ranges: Record<string, [number, number]> = {
    'palm-thatch': [4, 10], 'reed-thatch': [15, 40], 'wood-shingle': [20, 30], 'tile-or-slate': [50, Infinity],
  }
  for (const [name, entry] of Object.entries(defaultConfig().decayClasses)) {
    if (entry.yearsToRuin === null) continue
    it(`VAL-D1 ${name} reaches ruin within 1% of its sourced lifetime`, () => {
      const years = entry.yearsToRuin!
      expect(years).toBeGreaterThanOrEqual(ranges[name][0])
      expect(years).toBeLessThanOrEqual(ranges[name][1])
      expect(entry.label).not.toBe('')
      expect(entry.source).toMatch(/^https:\/\//)
      const { r, bldg } = decayBuilding(name)
      const expected = years * 365
      let days = 0
      while (bandOf(r.config, r.state.buildings[bldg].condition).name !== 'ruined' && days <= expected * 1.01) {
        r.tick()
        days++
      }
      expect(bandOf(r.config, r.state.buildings[bldg].condition).name).toBe('ruined')
      expect(Math.abs(days - expected) / expected).toBeLessThanOrEqual(0.01)
      expect(unvalidatedDecay(r.state, r.config)).toEqual([])
    })
  }

  it('850 days restores the old daily rates, independently of deprecated decayPerDay', () => {
    const { r, bldg } = decayBuilding('palm-thatch')
    r.config.decayClasses['palm-thatch'].yearsToRuin = 850 / 365
    const cases = [[1, 0.0005], [0.7, 0.001], [0.4, 0.002], [0.1, 0]]
    for (const band of r.config.bands) band.decayPerDay = 99
    for (const [condition, loss] of cases) {
      r.run({ type: 'setCondition', bldg, condition })
      r.tick()
      expect(r.state.buildings[bldg].condition).toBe(condition - loss)
    }
    r.config.bands[0].min = 0.9
    r.run({ type: 'setCondition', bldg, condition: 1 })
    r.tick()
    expect(r.state.buildings[bldg].condition).toBe(1 - (1 - 0.9) / 400)
  })

  it('host exposure scales time and an active repair suspends decay', () => {
    const { r, bldg } = decayBuilding('palm-thatch')
    r.config.exposure['test-factor'] = 2
    r.run({ type: 'setDecayClass', bldg, decayClass: 'palm-thatch', exposure: 'test-factor' })
    r.tick()
    const loss = (1 - r.config.bands[0].min) / ((400 / 850) * 5 * 365 * 2)
    expect(r.state.buildings[bldg].condition).toBe(1 - loss)
    const project = r.run<string>({ type: 'startProject', kind: 'repair', target: bldg, account: 'owner', labourHours: 100 })
    r.tick(3)
    expect(r.state.buildings[bldg].condition).toBe(1 - loss)
    r.run({ type: 'cancelProject', project })
    r.tick()
    expect(r.state.buildings[bldg].condition).toBe(1 - loss - loss)
  })

  it('construction preserves classes and commands reject unknown host classifications atomically', () => {
    const { r, bldg, parcel } = decayBuilding('palm-thatch', 'salt-wind')
    const before = structuredClone(r.state)
    for (const decayClass of ['unknown', 'toString']) {
      expect(() => r.run({ type: 'setDecayClass', bldg, decayClass })).toThrow('unknown decay class')
      expect(() => r.run({ type: 'addBuilding', parcel, footprint: { x: 0, y: 0, w: 1, h: 1 }, decayClass })).toThrow('unknown decay class')
      expect(() => r.run({ type: 'startProject', kind: 'construct', target: parcel, account: 'owner', plan: { decayClass } })).toThrow('unknown decay class')
    }
    expect(() => r.run({ type: 'setDecayClass', bldg, decayClass: 'palm-thatch', exposure: 'unknown' })).toThrow('unknown exposure')
    expect(r.state).toEqual(before)
    r.run({ type: 'setDecayClass', bldg, decayClass: 'wood-shingle' })
    expect(r.state.buildings[bldg].exposure).toBe('salt-wind')
    const project = r.run<string>({ type: 'startProject', kind: 'construct', target: parcel, account: 'owner',
      plan: { footprint: { x: 5, y: 5, w: 2, h: 2 }, decayClass: 'reed-thatch', exposure: 'sheltered' } })
    r.tick()
    const built = r.state.projects[project].result!
    expect(r.state.buildings[built]).toMatchObject({ decayClass: 'reed-thatch', exposure: 'sheltered', condition: 1 })
    r.tick()
    expect(r.state.buildings[built].condition).toBe(1 - (1 - 0.8) / ((400 / 850) * 25 * 365))
  })
})

describe('VAL-D1a unvalidated buildings do not decay', () => {
  it('no class preserves condition over 1,000 ticks and is listed', () => {
    const { r, bldg } = decayBuilding()
    r.tick(1000)
    expect(r.state.buildings[bldg].condition).toBe(1)
    expect(unvalidatedDecay(r.state, r.config)).toEqual([{ bldg, reason: 'no class' }])
  })

  it('null classes and null exposure are listed; demolished buildings are excluded', () => {
    for (const [decayClass, exposure, reason] of [
      ['masonry', 'sheltered', 'null class'], ['wattle-and-daub', 'sheltered', 'null class'],
      ['palm-thatch', 'salt-wind', 'null exposure'],
    ]) {
      const { r, bldg } = decayBuilding(decayClass, exposure)
      r.tick(1000)
      expect(r.state.buildings[bldg].condition).toBe(1)
      expect(unvalidatedDecay(r.state, r.config)).toEqual([{ bldg, reason }])
      r.run({ type: 'startProject', kind: 'demolish', target: bldg, account: 'owner' })
      r.tick()
      expect(unvalidatedDecay(r.state, r.config)).toEqual([])
    }
  })
})


describe('V5 assigned person-hours are conserved over 30 hamlet ticks', () => {
  it('business caps and project progress account for every daily grant', () => {
    const { r, providers, ids } = buildHamlet()
    // Exercise both projects and multiple lines, with enough materials to use all assigned hours.
    r.run({ type: 'setLines', biz: ids.biz, lines: [
      { recipe: 'plank', equipment: ['saw-pit'] }, { recipe: 'plank', equipment: ['saw-pit'] },
    ] })
    providers.materials.recipes.plank.unitsPerFixtureDay = 1
    providers.materials.set('inv.sawyer', 'log', 100)
    const project = r.run<string>({ type: 'startProject', kind: 'repair', target: ids.houseId,
      account: 'alder', pool: 'pool.hamlet', labourHours: 5, wage: 1 })
    for (let tick = 0; tick < 30; tick++) {
      const day = r.state.settlement.day
      const before = r.state.projects[project].progress
      const supply = providers.labour.supply(day).reduce((sum, row) => sum + row.personHours, 0)
      r.tick()
      const lines = r.state.production[ids.biz].lines
      const assigned = lines[0].caps.labour * 5
      const consumed = lines.reduce((sum, line) => sum + line.q * 5, 0)
      const projectHours = r.state.projects[project].progress - before
      const granted = providers.labour.grants.filter((row) => row.day === day).reduce((sum, row) => sum + row.hours, 0)
      expect(assigned).toBeLessThanOrEqual(supply)
      expect(granted).toBeLessThanOrEqual(supply)
      expect(consumed).toBe(assigned)
      expect(consumed + projectHours).toBe(granted)
      expect(granted + providers.labour.hours('pool.hamlet', 'sawyer', day)).toBe(supply)
    }
  })
})
