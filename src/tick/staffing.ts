// Step 3: each post resolves today's holder; a business is staffed when someone is in charge (operator or
// manager available: Q2) and every required post is filled. The outcome goes to ctx.staffed; production writes the status.
import type { Ctx } from '../context.ts'
import { isPool } from '../ids.ts'

// Transient grants belong to this tick context, never to saved posts or the provider's next day.
const assigned = new WeakMap<Ctx, Map<string, number>>()
export function assignedHours(ctx: Ctx, post: string): number { return assigned.get(ctx)?.get(post) ?? 0 }

export function staffing(ctx: Ctx): void {
  const day = ctx.state.settlement.day
  const labour = ctx.providers.labour
  const grants = new Map<string, number>()
  assigned.set(ctx, grants)
  const namedUsed = new Map<string, number>()
  for (const post of Object.values(ctx.state.posts)) {
    if (!post.holder) { post.filledBy = null; continue }
    let hours = 0
    if (isPool(post.holder)) hours = labour.draw(post.holder, post.role, post.requires, post.hours, day)
    else if (labour.available(post.holder, day)) {
      const used = namedUsed.get(post.holder) ?? 0
      hours = Math.max(0, Math.min(post.hours, labour.hours(post.holder, post.role, day) - used))
      namedUsed.set(post.holder, used + hours)
    }
    grants.set(post.id, hours)
    post.filledBy = hours > 0 || (post.hours === 0 && labour.available(post.holder, day)) ? post.holder : null
  }
  for (const biz of Object.values(ctx.state.businesses)) {
    if (!biz.open) continue
    const inCharge = labour.available(biz.operator, day) || (biz.manager !== null && labour.available(biz.manager, day))
    const required = biz.posts.map((id) => ctx.state.posts[id]).filter((post) => post.required)
    const filled = required.every((post) => post.filledBy !== null)
    if (inCharge && filled) ctx.staffed.add(biz.id)
  }
}
