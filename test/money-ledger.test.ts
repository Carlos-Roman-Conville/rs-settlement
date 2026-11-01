import { describe, expect, it } from 'vitest'
import { transfer, TransferJournal } from '@rex/kernel'
import { buildHamlet } from '../examples/hamlet.ts'
import { accountOf, type Ctx } from '../src/context.ts'
import { defaultConfig } from '../src/config.ts'
import { moneyLedger } from '../src/money-ledger.ts'
import { stubProviders } from '../src/providers.ts'
import { balanceOf, totalMoney } from '../src/queries.ts'
import { Runner } from '../src/reduce.ts'
import { initialState } from '../src/state.ts'

function fresh(): Ctx {
  return { state: initialState('stl.test', 'test'), config: defaultConfig(), providers: stubProviders(),
    events: [], staffed: new Set() }
}

describe('U25 kernel transfers conserve settlement money and preserve payment records', () => {
  it('a wage day debits the payer and credits the holder by exactly the wage', () => {
    const { r, ids } = buildHamlet()
    const before = structuredClone(r.state)
    r.events.length = 0
    r.tick()
    const wage = before.posts[ids.post].wage
    expect(balanceOf(r.state, ids.biz) - balanceOf(before, ids.biz)).toBe(-wage)
    expect(balanceOf(r.state, 'pool.hamlet') - balanceOf(before, 'pool.hamlet')).toBe(wage)
    expect(totalMoney(r.state)).toBe(totalMoney(before))
    expect(r.state.ledger.slice(before.ledger.length)).toEqual([{
      id: `txn.${String(before.counters.txn! + 1).padStart(4, '0')}`, day: before.settlement.day,
      kind: 'wage', from: ids.biz, to: 'pool.hamlet', subject: ids.post, amount: wage, authority: null, note: '',
    }])
    expect(r.events.filter(event => event.type === 'wagePaid')).toEqual([
      { type: 'wagePaid', post: ids.post, to: 'pool.hamlet', amount: wage },
    ])
  })

  it('a pay command returns its unchanged row and creates accounts in payer/payee order', () => {
    const r = new Runner(initialState('stl.test', 'test'))
    const total = totalMoney(r.state)
    const id = r.run<string>({ type: 'pay', from: 'buyer', to: 'seller', amount: 7, kind: 'purchase', subject: 'goods', note: 'test' })
    expect(r.state.accounts['acct.0002']).toEqual({ id: 'acct.0002', holder: 'buyer', balance: -7 })
    expect(r.state.accounts['acct.0003']).toEqual({ id: 'acct.0003', holder: 'seller', balance: 7 })
    expect(totalMoney(r.state)).toBe(total)
    expect(r.state.ledger).toEqual([{ id, day: 0, kind: 'purchase', from: 'buyer', to: 'seller',
      subject: 'goods', amount: 7, authority: null, note: 'test' }])
    expect(id).toBe('txn.0001')
  })

  it('a sale at price zero writes one row without moving balances', () => {
    const { r, ids } = buildHamlet()
    const title = Object.values(r.state.titles).find(entry => entry.subject === ids.p1)!
    const before = structuredClone(r.state)
    r.run({ type: 'sell', title: title.id, buyer: 'town', price: 0 })
    expect(r.state.accounts).toEqual(before.accounts)
    expect(r.state.ledger.slice(before.ledger.length)).toHaveLength(1)
    expect(r.state.ledger.at(-1)).toMatchObject({ kind: 'sale', amount: 0 })
  })

  it('a self-payment writes one row without moving balances', () => {
    const r = new Runner(initialState('stl.test', 'test'))
    const before = structuredClone(r.state.accounts)
    r.run({ type: 'pay', from: 'town', to: 'town', amount: 7, kind: 'wage' })
    expect(r.state.accounts).toEqual(before)
    expect(r.state.ledger).toHaveLength(1)
    expect(r.state.ledger[0]).toMatchObject({ kind: 'wage', amount: 7 })
  })

  it('unit recognizes holders and money only, without creating accounts', () => {
    const ctx = fresh()
    const before = structuredClone(ctx.state)
    const ledger = moneyLedger(ctx)
    expect(ledger.id).toBe('settlement.money')
    expect(ledger.unit('town', 'money')).toBe('money')
    expect(() => ledger.unit('missing', 'money')).toThrow('unknown money holder')
    expect(() => ledger.unit('acct.0001', 'money')).toThrow('unknown money holder')
    expect(() => ledger.unit('town', 'goods')).toThrow('unknown currency: goods')
    expect(ctx.state).toEqual(before)
  })

  it('a payer at zero still pays wages and enters debt (Q19 stays open)', () => {
    const { r, ids } = buildHamlet()
    r.run({ type: 'debit', holder: ids.biz, amount: balanceOf(r.state, ids.biz) })
    const before = totalMoney(r.state)
    r.tick()
    expect(balanceOf(r.state, ids.biz)).toBe(-r.state.posts[ids.post].wage)
    expect(totalMoney(r.state)).toBe(before)
  })

  it('a failed second transfer rolls back the first transfer and its journal atomically', () => {
    const ctx = fresh()
    accountOf(ctx, 'worker')
    const before = structuredClone(ctx.state.accounts)
    const ledger = moneyLedger(ctx)
    const journal = new TransferJournal('settlement.money')
    const request = { t: 0, process: 'test', quantity: 'money', unit: 'money', amount: 3,
      from: { ledger, account: 'town' }, to: { ledger, account: 'worker' } }
    expect(() => transfer(journal, request, { ...request, to: { ledger, account: 'missing' } })).toThrow('unknown money holder')
    expect(ctx.state.accounts).toEqual(before)
    expect(journal.entries()).toEqual([])
  })

  it('snapshots and restored accounts are detached and apply permits negative balances', () => {
    const ctx = fresh()
    const ledger = moneyLedger(ctx)
    const snapshot = ledger.snapshot()
    ledger.apply('town', 'money', -5)
    ledger.restore(snapshot)
    expect(balanceOf(ctx.state, 'town')).toBe(0)
    ledger.apply('town', 'money', -2)
    ledger.restore(snapshot)
    expect(balanceOf(ctx.state, 'town')).toBe(0)
  })

  it('five hamlet days replay byte-identically and match the pre-transfer state and events', async () => {
    const first = buildHamlet().r
    const second = buildHamlet().r
    first.tick(5)
    second.tick(5)
    const serialized = JSON.stringify({ state: first.state, events: first.events })
    expect(JSON.stringify({ state: second.state, events: second.events })).toBe(serialized)
    // Captured from the unchanged engine before moving pay() onto kernel transfer.
    const specifier = 'node:crypto'
    const { createHash } = await import(/* @vite-ignore */ specifier)
    expect(createHash('sha256').update(serialized).digest('hex')).toBe('40a04409064f5484fbe33792afd60d8bf4af33204fa1dc255241251f544deffc')
  })
})
