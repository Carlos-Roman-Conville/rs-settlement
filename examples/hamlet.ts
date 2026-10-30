// A hamlet with no game data: three parcels, one house, one workshop with a single line, a pool of workers.
// The reuse proof (TESTS.md): every command kind the pirate adapter will use, with nothing pirate on disk.
import { Runner } from '../src/reduce.ts'
import { initialState } from '../src/state.ts'
import { stubProviders } from '../src/providers.ts'
import { defaultConfig } from '../src/config.ts'

export function buildHamlet() {
  const providers = stubProviders({
    'plank': { inputs: [{ good: 'log', units: 1 }], output: 'plank', yield: 4, unitsPerFixtureDay: 5, labourHoursPerUnit: 5 },
  })
  providers.labour.pools['pool.hamlet'] = 3
  const r = new Runner(initialState('stl.hamlet', 'The hamlet'), defaultConfig(), providers)
  const dist = r.run<string>({ type: 'addDistrict', name: 'the green', kind: 'housing', bounds: { x: 0, y: 0, w: 40, h: 30 } })
  const p1 = r.run<string>({ type: 'addParcel', district: dist, footprint: { x: 0, y: 0, w: 10, h: 10 }, access: ['road'] })
  const p2 = r.run<string>({ type: 'addParcel', district: dist, footprint: { x: 12, y: 0, w: 12, h: 10 }, access: ['road'] })
  const p3 = r.run<string>({ type: 'addParcel', district: dist, footprint: { x: 0, y: 12, w: 24, h: 10 }, access: ['road'] })
  r.run({ type: 'grantTitle', subject: p1, holder: 'alder' })
  r.run({ type: 'grantTitle', subject: p2, holder: 'alder' })
  r.run({ type: 'grantTitle', subject: p3, holder: 'town' })
  r.run({ type: 'credit', holder: 'alder', amount: 100 })
  r.run({ type: 'credit', holder: 'town', amount: 100 })
  providers.materials.set('alder', 'timber', 20)
  const house = r.run<string>({ type: 'startProject', kind: 'construct', target: p1, account: 'alder', pool: 'pool.hamlet', wage: 1,
    labourHours: 20, materials: [{ material: 'timber', units: 10 }],
    plan: { decayClass: 'reed-thatch', // a timber cottage under a reed roof
      footprint: { x: 1, y: 1, w: 6, h: 5 }, rooms: [{ id: 'hall', name: 'hall', tiles: { x: 1, y: 1, w: 6, h: 5 }, use: 'living' }] } })
  const shop = r.run<string>({ type: 'startProject', kind: 'construct', target: p2, account: 'alder', pool: 'pool.hamlet', wage: 1,
    labourHours: 20, materials: [{ material: 'timber', units: 10 }],
    plan: { decayClass: 'wood-shingle', // the timber shop under a shingle roof
      footprint: { x: 13, y: 1, w: 8, h: 6 }, addFixtures: ['saw-pit'],
      rooms: [{ id: 'floor', name: 'the floor', tiles: { x: 13, y: 1, w: 8, h: 6 }, use: 'work' }],
      placements: [{ fixture: 'saw-pit', room: 'floor', at: { x: 14, y: 2 } }] } })
  r.tick(2)
  const houseId = r.state.projects[house].result!
  const shopId = r.state.projects[shop].result!
  r.run({ type: 'grantTitle', subject: shopId, holder: 'alder' })
  r.run({ type: 'assign', person: 'alder', kind: 'residence', target: houseId })
  const biz = r.run<string>({ type: 'openBusiness', kind: 'sawyer', premises: [{ bldg: shopId, rooms: ['floor'] }], operator: 'alder',
    inventory: 'inv.sawyer', lines: [{ recipe: 'plank', equipment: ['saw-pit'] }] })
  const post = r.run<string>({ type: 'addPost', biz, role: 'sawyer', wage: 2 })
  r.run({ type: 'hire', post, holder: 'pool.hamlet' })
  providers.materials.set('inv.sawyer', 'log', 30)
  r.run({ type: 'credit', holder: biz, amount: 50 })
  return { r, providers, ids: { dist, p1, p2, p3, houseId, shopId, biz, post } }
}

/** Five days of the hamlet: what a script prints. */
export function runHamlet(days = 5) {
  const { r, ids } = buildHamlet()
  r.tick(days)
  return { day: r.state.settlement.day, production: r.state.production[ids.biz], ledger: r.state.ledger.length }
}
