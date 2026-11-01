// Not transfers between two holders: credit/debit move money into/out of the settlement;
// record() rows of amount 0 (titles, leases, offices, permits) are deeds, not money.
import type { TransferLedger } from '@rex/kernel'
import type { Ctx } from './context.ts'
import type { SettlementState } from './state.ts'

export function moneyLedger(ctx: Ctx): TransferLedger {
  const account = (holder: string, quantity: string) => {
    if (quantity !== 'money') throw new Error(`unknown money quantity: ${quantity}`)
    const found = Object.values(ctx.state.accounts).find(entry => entry.holder === holder)
    if (!found) throw new Error(`unknown money holder: ${holder}`)
    return found
  }
  return {
    id: 'settlement.money',
    unit(holder, quantity) {
      account(holder, quantity)
      return 'money'
    },
    apply(holder, quantity, delta) { account(holder, quantity).balance += delta },
    snapshot() { return structuredClone(ctx.state.accounts) },
    restore(snapshot) { ctx.state.accounts = structuredClone(snapshot) as SettlementState['accounts'] },
  }
}
