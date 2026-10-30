// Step 3: each post resolves today's holder; a business is staffed when someone is in charge (operator or
// manager available: Q2) and every required post is filled. The outcome goes to ctx.staffed; production writes the status.
import type { Ctx } from '../context.ts'
import { isPool } from '../ids.ts'

export function staffing(ctx: Ctx): void {
  const day = ctx.state.settlement.day
  const labour = ctx.providers.labour
  for (const post of Object.values(ctx.state.posts)) {
    if (!post.holder) { post.filledBy = null; continue }
    if (isPool(post.holder)) post.filledBy = labour.draw(post.holder, post.role, post.requires, 1, day) >= 1 ? post.holder : null
    else post.filledBy = labour.available(post.holder, day) ? post.holder : null
  }
  for (const biz of Object.values(ctx.state.businesses)) {
    if (!biz.open) continue
    const inCharge = labour.available(biz.operator, day) || (biz.manager !== null && labour.available(biz.manager, day))
    const required = biz.posts.map((id) => ctx.state.posts[id]).filter((post) => post.required)
    const filled = required.every((post) => post.filledBy !== null)
    if (inCharge && filled) ctx.staffed.add(biz.id)
  }
}
