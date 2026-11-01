// Step 5: filled posts pay their holders; active leases pay rent to the title holder. Every payment is a ledger row.
// Step 6 (public works): a public-works business pays its wages from the treasury instead of its own account.
import { pay, type Ctx } from '../context.ts'

export function wages(ctx: Ctx): void {
  for (const post of Object.values(ctx.state.posts)) {
    if (!post.filledBy || post.wage <= 0) continue
    const biz = ctx.state.businesses[post.biz]
    if (!biz) continue
    const payer = biz.publicWorks ? ctx.state.accounts[ctx.state.settlement.treasury].holder : biz.id
    pay(ctx, payer, post.filledBy, post.wage, 'wage', post.id, null, '', undefined, post.currency)
    ctx.events.push({ type: 'wagePaid', post: post.id, to: post.filledBy, amount: post.wage })
  }
  for (const lease of Object.values(ctx.state.leases)) {
    if (lease.status !== 'active' || lease.rent <= 0) continue
    const landlord = ctx.state.titles[lease.title].holder
    pay(ctx, lease.tenant, landlord, lease.rent, 'rent', lease.id, null, '', undefined, lease.currency)
    ctx.events.push({ type: 'rentPaid', lease: lease.id, to: landlord, amount: lease.rent })
  }
}

export function publicWorks(ctx: Ctx): void {
  // Wages of public-works businesses are already drawn from the treasury in `wages`; this step is where an
  // office's tax power will run once a host supplies the rule as data. Nothing is invented here.
  void ctx
}
