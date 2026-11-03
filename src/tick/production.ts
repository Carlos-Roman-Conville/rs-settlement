// Step 4: Q = min(Q_equipment, Q_labour, Q_materials, Q_utilities), the brief's first approximation, per line.
// Lines share the day's labour and fixture-days in order. The engine never knows what a recipe makes.
import { assignedHours } from './staffing.ts'
import { bandOf } from '../config.ts'
import { setStatus } from '../commands.ts'
import { finite as checked, type Ctx } from '../context.ts'

export function production(ctx: Ctx): void {
  if (ctx.config.labourSharing !== 'in-order') throw new Error(`open for Rex (Q15): labourSharing ${ctx.config.labourSharing}`)
  // Check every active line for Q20 before production changes any host inventory.
  productionPass(ctx, true)
  productionPass(ctx, false)
}

function productionPass(ctx: Ctx, checkOnly: boolean): void {
  const { labour, materials, utilities } = ctx.providers
  const day = ctx.state.settlement.day
  // Each pass starts with the same daily capacity, shared across all businesses.
  const remaining = new Map<string, Map<string, number>>()
  for (const bldg of Object.values(ctx.state.buildings)) {
    if (bldg.demolishedOn !== null) continue
    const factor = ctx.config.equipmentCondition === 'band-factor' ? bandOf(ctx.config, bldg.condition).outputFactor : 1
    const fixtures = new Map<string, number>()
    for (const fixture of bldg.fixtures) fixtures.set(fixture, (fixtures.get(fixture) ?? 0) + 1)
    for (const [fixture, count] of fixtures) fixtures.set(fixture, count * factor)
    remaining.set(bldg.id, fixtures)
  }
  for (const biz of Object.values(ctx.state.businesses)) {
    if (!biz.open || !ctx.staffed.has(biz.id)) {
      if (!checkOnly) { delete ctx.state.production[biz.id]; setStatus(ctx, biz.id, 'dormant') }
      continue
    }
    let labourHours = 0
    for (const id of biz.posts) {
      const post = ctx.state.posts[id]
      if (post.filledBy) labourHours += assignedHours(ctx, post.id) * labour.productivity(post.filledBy, post.role)
    }
    const lines: { recipe: string; q: number; caps: Record<string, number> }[] = []
    let produced = false
    // Several room scopes in one building still refer to the same fixtures.
    const buildings = [...new Set(biz.premises.map((premises) => premises.bldg))]
    for (const [lineIndex, line] of biz.lines.entries()) {
      const rates = materials.rates(line.recipe)
      const unitsPerFixtureDay = checked(rates.unitsPerFixtureDay, `rates(${line.recipe}).unitsPerFixtureDay`, 0)
      const labourHoursPerUnit = checked(rates.labourHoursPerUnit, `rates(${line.recipe}).labourHoursPerUnit`, 0)
      let equipment = Number.POSITIVE_INFINITY
      const fixtures = new Set(line.equipment)
      for (const fixture of fixtures) {
        let fixtureDays = 0
        for (const bldg of buildings) fixtureDays += remaining.get(bldg)?.get(fixture) ?? 0
        equipment = Math.min(equipment, fixtureDays * unitsPerFixtureDay)
      }
      const labourCap = labourHoursPerUnit > 0 ? labourHours / labourHoursPerUnit : Number.POSITIVE_INFINITY
      const materialCap = materials.available(biz.inventory, line.recipe)
      let utility = Number.POSITIVE_INFINITY
      for (const premises of biz.premises) utility = Math.min(utility, utilities.capacity(premises.bldg, line.recipe, ctx.state))
      const q = Math.max(0, Math.floor(Math.min(equipment, labourCap, materialCap, utility)))
      if (!Number.isFinite(q)) throw new Error(`open for Rex (Q20): non-finite production Q for business ${biz.id}, line ${lineIndex + 1}, recipe ${line.recipe}`)
      if (q > 0 && unitsPerFixtureDay > 0) {
        for (const fixture of fixtures) {
          let needed = q / unitsPerFixtureDay
          for (const bldg of buildings) {
            const capacity = remaining.get(bldg)
            const available = capacity?.get(fixture) ?? 0
            const used = Math.min(needed, available)
            if (capacity) capacity.set(fixture, available - used)
            needed -= used
            if (needed <= 0) break
          }
        }
      }
      if (checkOnly) {
        labourHours -= q * labourHoursPerUnit
        continue
      }
      const finite = (value: number) => (Number.isFinite(value) ? value : -1)
      lines.push({ recipe: line.recipe, q, caps: { equipment: finite(equipment), labour: finite(labourCap), materials: finite(materialCap), utilities: finite(utility) } })
      if (q > 0) {
        materials.produce(biz.inventory, line.recipe, q)
        labourHours -= q * labourHoursPerUnit
        produced = true
      }
    }
    if (!checkOnly) {
      ctx.state.production[biz.id] = { day, lines }
      setStatus(ctx, biz.id, produced ? 'producing' : 'staffed')
    }
  }
}
