import { afterEach, describe, expect, it, vi } from 'vitest'
import * as kernel from '@rex/kernel'
import type { TransferLedger } from '@rex/kernel'
import { buildHamlet } from '../examples/hamlet.ts'
import type { Command } from '../src/commands.ts'
import { defaultConfig } from '../src/config.ts'
import { accountOf, type Ctx } from '../src/context.ts'
import { moneyLedger } from '../src/money-ledger.ts'
import { stubProviders, type CurrencyProvider } from '../src/providers.ts'
import { balanceOf, totalMoney, totalOf } from '../src/queries.ts'
import { Runner } from '../src/reduce.ts'
import { initialState } from '../src/state.ts'

const currencies: CurrencyProvider = { isCurrency: id => ['money', 'pieces', 'shells'].includes(id) }
const providers = () => ({ ...stubProviders(), currencies })
const fresh = () => new Runner(initialState('stl.test', 'test'), undefined, providers())
const snapshot = (r: Runner) => structuredClone({ state: r.state, log: r.log, events: r.events })
const exchange = (units = 3): Extract<Command, { legs: unknown }> => ({
  type: 'pay', kind: 'exchange', subject: 'fish', note: 'market', legs: {
    money: [
      { from: 'buyer', to: 'seller', currency: 'pieces', amount: 7 },
      { from: 'seller', to: 'buyer', currency: 'shells', amount: 2 },
    ],
    goods: [{ from: 'stall', to: 'bag', good: 'fish', units }],
  },
})

function inventory() {
  let stock: Record<string, Record<string, number>> = { stall: { fish: 10 }, bag: { fish: 0 } }
  const check = (account: string, good: string) => {
    if (!stock[account] || !(good in stock[account])) throw new Error('unknown inventory or good')
    return stock[account]
  }
  const apply = vi.fn((account: string, good: string, delta: number) => {
    const row = check(account, good)
    if (row[good] + delta < 0) throw new Error('insufficient stock')
    row[good] += delta
  })
  const ledger: TransferLedger = {
    id: 'test.goods',
    unit(account, good) { check(account, good); return 'count' },
    apply,
    snapshot() { return structuredClone(stock) },
    restore(snapshot) { stock = structuredClone(snapshot) as typeof stock },
  }
  return { ledger, apply, stock: () => structuredClone(stock) }
}

function wageFixture(currency = 'pieces') {
  const setup = fresh()
  const bounds = { x: 0, y: 0, w: 10, h: 10 }
  const district = setup.run<string>({ type: 'addDistrict', name: 'test', kind: 'test', bounds })
  const parcel = setup.run<string>({ type: 'addParcel', district, footprint: bounds })
  const bldg = setup.run<string>({ type: 'addBuilding', parcel, footprint: bounds })
  const title = setup.run<string>({ type: 'grantTitle', subject: bldg, holder: 'owner' })
  const biz = setup.run<string>({ type: 'openBusiness', kind: 'test', premises: [{ bldg }], operator: 'owner', inventory: 'inv.test' })
  const post = setup.run<string>({ type: 'addPost', biz, role: 'worker', wage: 2 })
  setup.run({ type: 'hire', post, holder: 'worker' })
  const lease = setup.run<string>({ type: 'lease', title, tenant: 'tenant', rent: 3 })
  // Currency is seeded host data on Post/Lease; their creation commands are unchanged by §22.
  setup.state.posts[post].currency = currency
  setup.state.leases[lease].currency = currency
  const from = structuredClone(setup.state)
  return { r: new Runner(structuredClone(from), undefined, providers()), from, biz, post, lease }
}

afterEach(() => vi.restoreAllMocks())

describe('U27 currencies and N-leg payments satisfy §22 T1–T6', () => {
  it('T1 conserves each currency through mixed payments, issues, retires and 30 wage/rent days', () => {
    const { r, biz, post, lease } = wageFixture()
    const ids = ['money', 'pieces', 'shells']
    const starts = ids.map(currency => totalOf(r.state, currency))
    const firstRow = r.state.ledger.length
    for (let day = 0; day < 30; day++) {
      for (const currency of ids) {
        r.run({ type: 'credit', holder: biz, amount: 10, currency, process: 'test.issue' })
        r.run({ type: 'debit', holder: biz, amount: 1, currency, process: 'test.retire' })
        r.run({ type: 'pay', from: biz, to: 'worker', amount: 4, currency, kind: 'purchase' })
      }
      r.run({ ...exchange(), legs: { money: exchange().legs.money } })
      r.tick()
      const rows = r.state.ledger.slice(firstRow)
      for (const [index, currency] of ids.entries()) {
        const net = rows.filter(row => (row.currency ?? 'money') === currency)
          .reduce((sum, row) => sum + (row.kind === 'credit' ? row.amount : row.kind === 'debit' ? -row.amount : 0), 0)
        expect(totalOf(r.state, currency)).toBe(starts[index] + net)
      }
      expect(rows.filter(row => row.kind === 'wage' && row.subject === post)).toHaveLength(day + 1)
      expect(rows.filter(row => row.kind === 'rent' && row.subject === lease)).toHaveLength(day + 1)
      expect(rows.filter(row => row.kind === 'wage' || row.kind === 'rent').every(row => row.currency === 'pieces')).toBe(true)
      expect(balanceOf(r.state, 'tenant', 'pieces')).toBe(-3 * (day + 1))
      expect(balanceOf(r.state, 'owner', 'pieces')).toBe(3 * (day + 1))
      expect(balanceOf(r.state, 'worker', 'pieces')).toBe(6 * (day + 1))
      expect(totalMoney(r.state)).toBe(totalOf(r.state, 'money'))
    }
  })

  it('an exchange applies exact deltas in one ordered transfer and returns batched row ids', () => {
    const r = fresh()
    const goods = inventory()
    const transfer = vi.spyOn(kernel, 'transfer')
    const ids = r.run<string[]>(exchange(), { goods: goods.ledger })
    expect(transfer).toHaveBeenCalledTimes(1)
    expect(transfer.mock.calls[0].slice(1)).toMatchObject([
      { t: 0, quantity: 'pieces', unit: 'pieces', process: 'settlement.ledger.pay', note: 'exchange' },
      { t: 0, quantity: 'shells', unit: 'shells', process: 'settlement.ledger.pay', note: 'exchange' },
      { t: 0, quantity: 'fish', unit: 'count', process: 'economy.trade.trade', note: 'exchange' },
    ])
    expect(ids).toEqual(r.state.ledger.map(row => row.id))
    expect(r.state.ledger).toMatchObject([
      { currency: 'pieces', batch: ids[0], amount: 7, subject: 'fish', note: 'market' },
      { currency: 'shells', batch: ids[0], amount: 2, subject: 'fish', note: 'market' },
    ])
    expect(balanceOf(r.state, 'buyer', 'pieces')).toBe(-7)
    expect(balanceOf(r.state, 'seller', 'pieces')).toBe(7)
    expect(balanceOf(r.state, 'buyer', 'shells')).toBe(2)
    expect(balanceOf(r.state, 'seller', 'shells')).toBe(-2)
    expect(goods.stock()).toEqual({ stall: { fish: 7 }, bag: { fish: 3 } })
    expect(r.events).toEqual([])
  })

  it('barter moves goods in order without rows or money accounts', () => {
    const r = fresh()
    const goods = inventory()
    const accounts = structuredClone(r.state.accounts)
    expect(r.run({ type: 'pay', kind: 'barter', legs: { money: [], goods: [
      { from: 'stall', to: 'bag', good: 'fish', units: 4 },
      { from: 'bag', to: 'stall', good: 'fish', units: 1.5 },
    ] } }, { goods: goods.ledger })).toEqual([])
    expect(goods.stock()).toEqual({ stall: { fish: 7.5 }, bag: { fish: 2.5 } })
    expect(r.state.accounts).toEqual(accounts)
    expect(r.state.ledger).toEqual([])
    expect(r.events).toEqual([])
  })

  it('zero and self money legs retain rows but neither move balances nor create currency maps', () => {
    const r = fresh()
    const goods = inventory()
    const transfer = vi.spyOn(kernel, 'transfer')
    const ids = r.run<string[]>({ type: 'pay', kind: 'test', legs: { money: [
      { from: 'a', to: 'b', currency: 'pieces', amount: 0 },
      { from: 'a', to: 'a', currency: 'shells', amount: 5 },
      { from: 'a', to: 'b', currency: 'money', amount: 2 },
    ], goods: [{ from: 'stall', to: 'bag', good: 'fish', units: 0 }] } }, { goods: goods.ledger })
    expect(transfer).toHaveBeenCalledTimes(1)
    expect(transfer.mock.calls[0]).toHaveLength(2)
    expect(goods.apply).not.toHaveBeenCalled()
    expect(r.state.ledger.map(row => row.batch)).toEqual(ids.map(() => ids[0]))
    expect(r.state.ledger.map(row => row.amount)).toEqual([0, 5, 2])
    expect(r.state.ledger[2]).not.toHaveProperty('currency')
    expect(Object.values(r.state.accounts).every(account => !Object.hasOwn(account, 'balances'))).toBe(true)
    expect(balanceOf(r.state, 'a')).toBe(-2)
    expect(balanceOf(r.state, 'b')).toBe(2)
  })

  it('an empty batch and an all-omitted batch never call transfer', () => {
    const r = fresh()
    const transfer = vi.spyOn(kernel, 'transfer')
    expect(r.run({ type: 'pay', kind: 'empty', legs: { money: [] } })).toEqual([])
    expect(r.run({ type: 'pay', kind: 'self', legs: { money: [
      { from: 'town', to: 'town', currency: 'money', amount: 1 },
    ] } })).toHaveLength(1)
    expect(transfer).not.toHaveBeenCalled()
  })

  it('T2 replays live exchanges and wage/rent ticks from plain JSON without goods opts', () => {
    const { r, from } = wageFixture()
    const goods = inventory()
    r.run(exchange(), { goods: goods.ledger })
    r.tick(2)
    r.run(exchange(2), { goods: goods.ledger })
    expect(JSON.parse(JSON.stringify(r.log))).toEqual(r.log)
    expect(JSON.stringify(r.log)).not.toContain('test.goods')
    const before = goods.stock()
    const replay = Runner.replay(r.log, undefined, providers(), from)
    expect(kernel.canonical(replay.state)).toBe(kernel.canonical(r.state))
    expect(replay.events).toEqual(r.events)
    expect(goods.stock()).toEqual(before)
  })

  it('T3 a goods refusal after two money legs rolls back state, log, events and stock', () => {
    const r = fresh()
    const goods = inventory()
    const before = snapshot(r)
    const stock = goods.stock()
    expect(() => r.run(exchange(11), { goods: goods.ledger })).toThrow('insufficient stock')
    expect(goods.apply).toHaveBeenCalledWith('stall', 'fish', -11)
    expect(snapshot(r)).toEqual(before)
    expect(goods.stock()).toEqual(stock)
  })

  it('T3 an unknown final currency is rejected before transfer or goods queries', () => {
    const r = fresh()
    const goods = inventory()
    const before = snapshot(r)
    const stock = goods.stock()
    const command = exchange()
    command.legs.money.push({ from: 'a', to: 'b', currency: 'unknown', amount: 1 })
    const transfer = vi.spyOn(kernel, 'transfer')
    const unit = vi.spyOn(goods.ledger, 'unit')
    expect(() => r.run(command, { goods: goods.ledger })).toThrow('unknown currency: unknown')
    expect(transfer).not.toHaveBeenCalled()
    expect(unit).not.toHaveBeenCalled()
    expect(snapshot(r)).toEqual(before)
    expect(goods.stock()).toEqual(stock)
  })

  it('T4 a single shells payment at zero enters debt with no balance refusal', () => {
    const r = fresh()
    r.run({ type: 'pay', from: 'a', to: 'b', amount: 2.5, currency: 'shells', kind: 'purchase' })
    expect(balanceOf(r.state, 'a', 'shells')).toBe(-2.5)
    expect(balanceOf(r.state, 'b', 'shells')).toBe(2.5)
    expect(totalOf(r.state, 'shells')).toBe(0)
    expect(r.state.ledger[0]).toMatchObject({ currency: 'shells', amount: 2.5 })
    expect(r.state.ledger[0]).not.toHaveProperty('batch')
  })

  it('T5 existing hamlet payments and ticks write no new fields without a currency provider', () => {
    const { r } = buildHamlet()
    r.run({ type: 'pay', from: 'town', to: 'alder', amount: 3, currency: 'money', kind: 'gift' })
    r.tick(30)
    expect(JSON.stringify(r.state)).not.toMatch(/"(?:currency|batch|process|balances)":/)
  })

  it('T6 unknown currencies in single pay, N-leg pay, credit and debit change nothing', () => {
    const r = fresh()
    const before = snapshot(r)
    const commands: Command[] = [
      { type: 'pay', from: 'a', to: 'b', amount: 0, currency: 'unknown', kind: 'test' },
      { type: 'pay', kind: 'test', legs: { money: [{ from: 'a', to: 'a', amount: 0, currency: 'unknown' }] } },
      { type: 'credit', holder: 'a', amount: 1, currency: 'unknown', process: 'test.issue' },
      { type: 'debit', holder: 'a', amount: 1, currency: 'unknown', process: 'test.retire' },
    ]
    for (const command of commands) {
      expect(() => r.run(command)).toThrow('unknown currency: unknown')
      expect(snapshot(r)).toEqual(before)
    }
  })

  it('T6 an unknown post wage or lease rent rejects the tick without settlement changes', () => {
    for (const target of ['post', 'lease'] as const) {
      const { r, post, lease } = wageFixture('money')
      if (target === 'post') r.state.posts[post].currency = 'unknown'
      else r.state.leases[lease].currency = 'unknown'
      const before = snapshot(r)
      expect(() => r.tick()).toThrow('unknown currency: unknown')
      expect(snapshot(r)).toEqual(before)
    }
  })

  it('T6 pieces is unknown without a provider but money never requires provider approval', () => {
    const r = new Runner(initialState('stl.test', 'test'))
    const before = snapshot(r)
    expect(() => r.run({ type: 'pay', from: 'a', to: 'b', amount: 1, currency: 'pieces', kind: 'test' }))
      .toThrow('unknown currency: pieces')
    expect(snapshot(r)).toEqual(before)
    r.providers.currencies = { isCurrency: () => false }
    r.run({ type: 'pay', from: 'a', to: 'b', amount: 1, currency: 'money', kind: 'test' })
    expect(balanceOf(r.state, 'b')).toBe(1)
  })

  it('T6 unknown wages reject before production stock or labour grants can move', () => {
    const { r, providers, ids } = buildHamlet()
    r.state.posts[ids.post].currency = 'unknown'
    const before = snapshot(r)
    const stock = structuredClone(providers.materials.stock)
    const grants = structuredClone(providers.labour.grants)
    expect(() => r.tick()).toThrow('unknown currency: unknown')
    expect(snapshot(r)).toEqual(before)
    expect(providers.materials.stock).toEqual(stock)
    expect(providers.labour.grants).toEqual(grants)
  })

  it('issue and retire require a process in other currencies and record it with exact balances', () => {
    const r = fresh()
    const before = snapshot(r)
    for (const type of ['credit', 'debit'] as const) {
      expect(() => r.run({ type, holder: 'a', amount: 5, currency: 'pieces' })).toThrow(`${type}: a process is required`)
      expect(snapshot(r)).toEqual(before)
    }
    r.run({ type: 'credit', holder: 'a', amount: 5, currency: 'pieces', process: 'test.issue' })
    r.run({ type: 'debit', holder: 'a', amount: 7, currency: 'pieces', process: 'test.retire' })
    expect(balanceOf(r.state, 'a', 'pieces')).toBe(-2)
    expect(balanceOf(r.state, 'a')).toBe(0)
    expect(r.state.ledger).toMatchObject([
      { kind: 'credit', currency: 'pieces', process: 'test.issue', amount: 5 },
      { kind: 'debit', currency: 'pieces', process: 'test.retire', amount: 7 },
    ])
    r.run({ type: 'credit', holder: 'a', amount: 1, process: 'test.money' })
    expect(r.state.ledger.at(-1)).toMatchObject({ process: 'test.money' })
    expect(r.state.ledger.at(-1)).not.toHaveProperty('currency')
  })

  it('mixed forms refuse each single-payment field even when its value is undefined', () => {
    const r = fresh()
    const before = snapshot(r)
    for (const [key, value] of Object.entries({ from: 'a', to: 'b', amount: 1, currency: 'money', goods: undefined })) {
      const command = { ...exchange(), [key]: value } as Command
      expect(() => r.run(command)).toThrow('pay: legs cannot be combined with single-payment fields')
    }
    expect(snapshot(r)).toEqual(before)
  })

  it('a never-moved currency reads zero without creating a balance map', () => {
    const r = fresh()
    const before = structuredClone(r.state)
    expect(balanceOf(r.state, 'town', 'pieces')).toBe(0)
    expect(balanceOf(r.state, 'missing', 'pieces')).toBe(0)
    expect(totalOf(r.state, 'pieces')).toBe(0)
    expect(r.state).toEqual(before)
  })

  it('a goods ledger without goods legs is refused for both missing and empty goods arrays', () => {
    const r = fresh()
    const goods = inventory()
    const before = snapshot(r)
    for (const data of [undefined, []]) {
      expect(() => r.run({ type: 'pay', kind: 'test', legs: { money: [], goods: data } }, { goods: goods.ledger }))
        .toThrow('pay: a goods ledger was passed without goods data')
    }
    expect(snapshot(r)).toEqual(before)
    expect(goods.apply).not.toHaveBeenCalled()
  })

  it('all legs validate finite nonnegative quantities and nonempty strings even during replay', () => {
    const r = fresh()
    const before = snapshot(r)
    for (const value of [-1, NaN, Infinity]) {
      const money = exchange()
      money.legs.money[1].amount = value
      expect(() => r.run(money)).toThrow()
      expect(() => r.run(exchange(value))).toThrow()
    }
    for (const key of ['from', 'to', 'currency'] as const) {
      const command = exchange()
      command.legs.money[1][key] = ''
      expect(() => r.run(command)).toThrow()
    }
    for (const key of ['from', 'to', 'good'] as const) {
      const command = exchange()
      command.legs.goods![0][key] = ''
      expect(() => r.run(command)).toThrow()
    }
    expect(snapshot(r)).toEqual(before)
  })

  it('moneyLedger validates currencies and holders, creates entries only on apply, and restores all balances', () => {
    const ctx: Ctx = { state: fresh().state, config: defaultConfig(), providers: providers(), events: [], staffed: new Set() }
    accountOf(ctx, 'a')
    const ledger = moneyLedger(ctx)
    const before = ledger.snapshot()
    expect(ledger.unit('a', 'pieces')).toBe('pieces')
    expect(ledger.snapshot()).toEqual(before)
    expect(() => ledger.unit('missing', 'pieces')).toThrow('unknown money holder: missing')
    ledger.apply('a', 'pieces', -3)
    ledger.apply('a', 'shells', 2)
    expect(balanceOf(ctx.state, 'a', 'pieces')).toBe(-3)
    expect(balanceOf(ctx.state, 'a', 'shells')).toBe(2)
    expect(balanceOf(ctx.state, 'a')).toBe(0)
    ledger.restore(before)
    expect(ledger.snapshot()).toEqual(before)
  })
})
