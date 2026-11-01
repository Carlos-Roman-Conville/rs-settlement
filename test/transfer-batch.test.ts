import { describe, expect, it, vi } from 'vitest'
import { canonical, type TransferLedger } from '@rex/kernel'
import type { Command } from '../src/commands.ts'
import { balanceOf, totalMoney } from '../src/queries.ts'
import { Runner } from '../src/reduce.ts'
import { initialState } from '../src/state.ts'

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

const payment = (units = 3, amount = 7): Extract<Command, { type: 'pay' }> => ({
  type: 'pay', from: 'buyer', to: 'seller', amount, kind: 'purchase', subject: 'fish', note: 'market',
  goods: { from: 'stall', to: 'bag', good: 'fish', units },
})
const fresh = () => new Runner(initialState('stl.test', 'test'))
const snapshot = (r: Runner) => structuredClone({ state: r.state, log: r.log, events: r.events })

describe('U26 money and goods commit in one transfer and replay exactly', () => {
  it('both legs conserve totals and write one caller-kind row without an event', () => {
    const r = fresh()
    const goods = inventory()
    const total = totalMoney(r.state)
    const id = r.run<string>(payment(), { goods: goods.ledger })
    expect(balanceOf(r.state, 'buyer')).toBe(-7)
    expect(balanceOf(r.state, 'seller')).toBe(7)
    expect(totalMoney(r.state)).toBe(total)
    expect(goods.stock()).toEqual({ stall: { fish: 7 }, bag: { fish: 3 } })
    expect(goods.stock().stall.fish + goods.stock().bag.fish).toBe(10)
    expect(r.state.ledger).toEqual([{ id, day: 0, kind: 'purchase', from: 'buyer', to: 'seller',
      subject: 'fish', amount: 7, authority: null, note: 'market' }])
    expect(r.events).toEqual([])
  })

  it('goods refusal after money restores stock and leaves state, log and events unchanged', () => {
    const r = fresh()
    const goods = inventory()
    const before = snapshot(r)
    const stock = goods.stock()
    expect(() => r.run(payment(11), { goods: goods.ledger })).toThrow('insufficient stock')
    expect(goods.apply).toHaveBeenCalledWith('stall', 'fish', -11)
    expect(snapshot(r)).toEqual(before)
    expect(goods.stock()).toEqual(stock)
    // A failed run must not leak its options into the next payment.
    const { goods: data, ...money } = payment()
    r.run(money)
    expect(goods.stock()).toEqual(stock)
  })

  it('zero units moves only money and never applies goods', () => {
    const r = fresh()
    const goods = inventory()
    r.run(payment(0), { goods: goods.ledger })
    expect(balanceOf(r.state, 'buyer')).toBe(-7)
    expect(goods.apply).not.toHaveBeenCalled()
  })

  it('zero amount moves only goods and records a zero row', () => {
    const r = fresh()
    const goods = inventory()
    r.run(payment(3, 0), { goods: goods.ledger })
    expect(balanceOf(r.state, 'buyer')).toBe(0)
    expect(balanceOf(r.state, 'seller')).toBe(0)
    expect(goods.stock()).toEqual({ stall: { fish: 7 }, bag: { fish: 3 } })
    expect(r.state.ledger).toHaveLength(1)
    expect(r.state.ledger[0].amount).toBe(0)
  })

  it('a ledger without data throws without changing anything', () => {
    const r = fresh()
    const goods = inventory()
    const before = snapshot(r)
    const stock = goods.stock()
    const { goods: data, ...money } = payment()
    expect(() => r.run(money, { goods: goods.ledger })).toThrow('pay: a goods ledger was passed without goods data')
    expect(snapshot(r)).toEqual(before)
    expect(goods.stock()).toEqual(stock)
  })

  it('data without a ledger moves only money and writes the live row exactly', () => {
    const live = fresh()
    const replay = fresh()
    live.run(payment(), { goods: inventory().ledger })
    replay.run(payment())
    expect(replay.state).toEqual(live.state)
  })

  it('two goods payments and a tick replay canonically with a plain JSON log', () => {
    const r = fresh()
    const goods = inventory()
    r.run(payment(), { goods: goods.ledger })
    r.tick()
    r.run(payment(2), { goods: goods.ledger })
    expect(JSON.parse(JSON.stringify(r.log))).toEqual(r.log)
    const replay = Runner.replay(r.log, undefined, undefined, initialState('stl.test', 'test'))
    expect(canonical(replay.state)).toBe(canonical(r.state))
    expect(replay.events).toEqual(r.events)
  })

  it('a payer at zero can buy into debt while Q19 remains open', () => {
    const r = fresh()
    expect(balanceOf(r.state, 'buyer')).toBe(0)
    r.run(payment(), { goods: inventory().ledger })
    expect(balanceOf(r.state, 'buyer')).toBe(-7)
  })

  it('fractional units move exactly 2.5 goods', () => {
    const goods = inventory()
    fresh().run(payment(2.5), { goods: goods.ledger })
    expect(goods.stock()).toEqual({ stall: { fish: 7.5 }, bag: { fish: 2.5 } })
  })

  it('replay validates finite nonnegative units and nonempty goods strings', () => {
    const r = fresh()
    const before = snapshot(r)
    for (const units of [-1, NaN, Infinity]) expect(() => r.run(payment(units))).toThrow()
    for (const key of ['from', 'to', 'good'] as const) {
      const command = payment()
      command.goods![key] = ''
      expect(() => r.run(command)).toThrow()
    }
    expect(snapshot(r)).toEqual(before)
  })
})
