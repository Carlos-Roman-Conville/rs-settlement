// Step 2: active projects draw their materials (all or nothing, from the project's inventory ref; the payer's
// account is a separate field), then labour from their pool, pay wages, and complete when the labour hours are done.
import { completeProject } from '../commands.ts'
import { pay, type Ctx } from '../context.ts'

export function projects(ctx: Ctx): void {
  const day = ctx.state.settlement.day
  for (const entry of Object.values(ctx.state.projects)) {
    if (entry.status !== 'active') continue
    if (!entry.materialsDrawn) {
      const inventory = entry.inventory
      if (!entry.materials.every((item) => ctx.providers.materials.have(inventory, item.material) >= item.units)) continue
      for (const item of entry.materials) {
        const taken = ctx.providers.materials.take(inventory, item.material, item.units)
        if (taken < item.units) throw new Error(`material provider shorted ${item.material} on ${entry.id}`)
      }
      entry.materialsDrawn = true
    }
    if (entry.permitRequired && !entry.permit) continue
    const wanted = entry.labourHours - entry.progress
    if (wanted > 0) {
      const hours = ctx.providers.labour.draw(entry.pool, 'labourer', null, wanted, day)
      if (hours > 0) {
        if (entry.wage > 0) pay(ctx, entry.account, entry.pool, entry.wage * hours / ctx.config.hoursPerDay, 'wage', entry.id)
        entry.progress += hours
      }
    }
    if (entry.progress >= entry.labourHours) completeProject(ctx, entry.id)
  }
}
