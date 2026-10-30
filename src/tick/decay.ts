// Step 1: sourced material lifetimes scale the proposed band shape; repair suspends decay.
import { bandOf } from '../config.ts'
import type { Ctx } from '../context.ts'

export function decay(ctx: Ctx): void {
  const repairing = new Set(Object.values(ctx.state.projects)
    .filter((entry) => entry.status === 'active' && entry.kind === 'repair').map((entry) => entry.target))
  for (const bldg of Object.values(ctx.state.buildings)) {
    if (bldg.demolishedOn !== null || repairing.has(bldg.id)) continue
    const years = bldg.decayClass === undefined ? null : ctx.config.decayClasses[bldg.decayClass]?.yearsToRuin
    const exposure = ctx.config.exposure[bldg.exposure ?? 'sheltered']
    if (years == null || exposure == null) continue
    const band = bandOf(ctx.config, bldg.condition)
    const share = ctx.config.decayShares[band.name]
    if (share === undefined) continue // ruined has no further decay
    const index = ctx.config.bands.indexOf(band)
    const upper = index === 0 ? 1 : ctx.config.bands[index - 1].min
    const dailyLoss = (upper - band.min) / (share * years * 365 * exposure)
    bldg.condition = Math.max(0, bldg.condition - dailyLoss)
  }
}
