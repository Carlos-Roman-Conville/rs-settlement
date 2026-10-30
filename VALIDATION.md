# Verification and validation (settlement keeper, 2026-10-30; PLATFORM.md §11a)

Rex's directive: the keeper, not Rex, answers for the mathematics. This file states, per mechanism this engine
owns, the model and its evidence level (PLATFORM.md §4: 1 established, 2 statistical, 3 historical observation,
4 simplified approximation, 5 hypothesis, 6 fiction), inputs and outputs with units, the tests that verify it,
the independent evidence it is validated against with a tolerance, the stability, conservation and boundary
tests, the integration tests, and an honest report. Three states, never conflated: **implemented** (code and unit
tests), **integrated** (wired through the contracts and, after P1, registry ports), **validated** (matches
independent evidence within the tolerance). Testing my own code is verification, not independence: validation
needs the sources below, the registry keeper's re-audit and check units written by another model.

Registry ids are `Toolchain/registry/mechanisms.json`'s. Test ids are `TESTS.md`'s (U, A, T) and this file's (V
for stability, conservation and boundary; VAL for validation against evidence). Sources are keyed as in
`Games/RPG's/pirate-ship/files/pirate-ship/SOURCES.md` (STL-*, TWN-*, ECON-*) or given inline.

## 1. Most of the engine is bookkeeping, and that matters

Titles, leases, assignments, offices, permissions, ids, layouts and the ledger are **rules of record, not models
of nature**: their correctness is logical (a sale changes the holder and nothing else; money is conserved), so
they need verification and conservation tests, and no empirical validation. Their content (who holds what, what
an office may do, which customs apply) is the host's data or the Government engine's, validated there. The
mechanisms below that carry a **numerical model of the world** are few: building decay, the production
constraint, the labour and equipment caps, construction labour, and the day's working hours. Wages and rents are
numbers the engine pays, not computes; their validation belongs to the host's data (STARTING_TOWN.md Q10) and to
the economy's quote.

## 2. Mechanisms

| Registry id | Model, evidence level | Inputs → outputs (units) | Verification | V (stability, conservation, boundary) | Validation (evidence, tolerance) | State |
|---|---|---|---|---|---|---|
| `settlement.ledger.pay` | double-entry transfer; level 1 (accounting identity) | amount (money) → two balances, one row | U5, U14, A1 | money conserved over every command and tick (U5, A1); **V1** 365-day hamlet conserves money to the unit | none needed (identity) | implemented, integrated (LedgerProvider via `pay`, economy I1, I2) |
| `settlement.property.title_transfer`, `.lease`, `.right_of_use` | rules of record; level 1 | commands → holders, tenants | U2, U3, A1, A2 | a refused sale writes no row (U3) | the rules are Rex's; customs are host data (TWN-LAW) | implemented, integrated (pirate T1, A1) |
| `settlement.assign.workforce` | non-exclusive assignments; level 1 | commands → assignments | U4, U12 | assignments never end on their own (U4) | Rex's rule (Q2) | implemented |
| `settlement.business.staffing` | a business is staffed iff open, someone in charge available, required posts filled; level 4 | posts, availability → status | U7 | **V2** status is a pure function of the day's inputs (same inputs, same status); one status writer, one event per change (U21) | Rex's rule (Q2); no period evidence needed | implemented |
| `settlement.production.constraint_Q` | `Q = floor(min(Q_equipment, Q_labour, Q_materials, Q_utilities))`, a Leontief (fixed-proportions) constraint; **level 4** (the brief's first approximation) | caps (units/day) → units/day | U6, U13, A1 | **V3** Q is monotone non-decreasing in every factor; zero in any factor gives zero (U6); **V4** an Infinity cap (a recipe with no inputs) never yields Infinity output | competing model: Cobb-Douglas or CES substitution between labour and equipment; no period output series for a single shop has been found (gap). Tolerance when one exists: daily output of a trade within ±30 % of the source's (PLATFORM §5's provisional 70 %) | implemented, integrated (economy I2); **not validated** |
| `settlement.production.labour_cap` | filled posts' worker-days (person-hours after P1) over labour per unit; lines share in order; **level 4**; sharing order is Rex's Q15 | posts, hours, productivity → units/day | U6, U7, A1; after P1 U18, U19 | **V5** (P1) hours assigned never exceed hours supplied (U18, pirate I3); labour is neither created nor lost across lines | hours per day: researched 11 working hours in a 12-hour day, London 1750s (STL-VOTH); config default 10 (SET-12): **within 10 %, accepted as within tolerance until Rex chooses**. Shop staffing 1 to 3 hands a shop (STL-PHIL) is host data, checked by **VAL-S1** on the starting data once Q10 is answered | implemented; P1 units 2617 to 2619 |
| `settlement.production.equipment_cap` | fixtures of each needed kind x units per fixture-day x the building's condition factor; **level 4** | fixtures, rates, condition → units/day | U6, A1 | **V3** monotone in fixtures and condition | rates are the economy's recipe data (validated there: ECON-5); the condition factor is level 5 (below) | implemented |
| `settlement.building.condition_decay`, `.condition_output_factor` | four bands, decay per day and output factor per band; **level 5 (hypothesis, no source)** | condition (0..1) → condition, factor | U7, U11 | **V6** condition stays in [0, 1], falls monotonically without repair, never below 0; a repair project raises it | **fails plausibility (SET-20)**: with today's bands a new building is ruined in about 850 days (2.3 years) without repair. Evidence: palm thatch lasts about 4 to 10 years, 4 on a salt-wind Caribbean coast, 5 to 8 for coconut palm (vendor and one academic abstract; secondary); brick and stone far longer. **VAL-D1** (queued as a todo until the model is reviewed): years from new to ruined by material class within the sourced range (thatch roof 4 to 10, timber 10 to 30, brick 50 or more, to be sourced). The fix is a model change (decay per material class), recorded and reviewed before it lands | implemented, interim class model (R-2); VAL-D1 passing |
| `settlement.project.construction` | a project needs its materials all or nothing, then labour-days (person-hours after P1) from a pool, then completes; **level 4** | materials, labour → a building, a layout | U8, U9, U16 | **V7** materials drawn equal materials named (no loss, no duplication); a cancelled project draws nothing more | evidence found: a typical Williamsburg house about a year of calendar time with carpenters dawn to dusk (Colonial Williamsburg, secondary); a New Netherland carpenter's contract for a house in about eight weeks (1630s, primary text via NAHC); a Massachusetts house build peaking at 18 men on site (Rundlet-May accounts, 1807). Not yet a labour-per-house figure. **VAL-C1** (for the starting data, after Q10): a small house's `labourHours` lies within the range those give (one carpenter for about 8 weeks, about 500 person-hours, to a crew for a year); tolerance a factor of 2 until a better source | implemented; not validated |
| `settlement.project.layout_versions`, `.land.parcel_split_merge` | geometry rules; level 1 | rects → rects | U1, U8, U9 | split children tile the parent exactly | none needed | implemented |
| `settlement.wage.pay`, `.wage.set_wage` | pay `Post.wage` per filled post per day; level 1; the level is the economy's (CONTRACTS §16) | wage (money/day) → rows | U5, U14; after P1 U17 | money conserved (U5) | wage levels are host data: **VAL-W1** (after Q10) every starting wage within the STARTING_TOWN.md benchmark band for its trade (estimate: labourer 2s, journeyman 4s, master 6s a day; tolerance ±50 %, the spread of the benchmarks STL-MOR, ECON-THO, STL-NAV) | implemented; P1 unit 2619 |
| `settlement.property.lease` rents | pay `Lease.rent` per day; level 1 | rent (money/day) → rows | U5, A1 | conserved | **VAL-R1** (after Q10): rents within the estimate band (0.25s to 1s a day by size); tolerance a factor of 2, weak evidence (one 1685 lot valuation, Blome's "as in London") | implemented |
| `settlement.expiry`, `.authority.office_powers`, `.query.fixtures`, `.infra.*` | rules and infrastructure; level 1 | | U10, U11, U12, U15 (kernel) | replay reproduces state (U15, kernel 2599) | none needed | implemented; kernel adoption under way |
| `settlement.scope_added.cemetery_sanitation_landuse` | not designed (PACKAGES s8) | | | | historical first when designed (Q16 to Q18) | proposed |

## 3. Integration tests (with Economy, on the contract)

- Economy's I1, I1b and I2 (pirate repo): thirty days of both engines; production equals the settlement's Q per
  line every day, money never changes, the economy log replays (CONTRACTS §2 to §9, §15).
- P1: pirate I3 (assigned hours never exceed supplied hours, settlement's 2618), I4a and I4b (the wage channel,
  economy's 2631), economy E17 and settlement's contract-text check (one interface).
- Kernel: P0 tests 1 to 3 (30 days on one clock, replay, the registry and units checks), units 2609 to 2611.

## 4. Report: accuracy, uncertainty, limitations, open questions

- **What is trustworthy now:** the ledger (conservation verified), the property rules, the tick order, replay.
  These are rules of record and are verified by construction and by test.
- **What is an approximation:** the production constraint (Leontief, level 4, no competing model tested), the
  labour cap and its in-order sharing (Q15), construction as labour-days. They behave as specified; nothing shows
  they match a real shop's output or a real build's time.
- **What failed:** building decay. Its placeholder bands ruin a building in 2.3 years; the evidence says years to
  decades by material. Recorded as SET-20; the proposed change (decay per material class, from sources) is a model
  change and waits for review; until then, a host running long games should treat condition as unvalidated.
- **What is missing as evidence:** a period shop's daily output, labour per house, a Port Royal rent in money,
  per-trade day wages in Jamaica or Barbados 1690 to 1720 (STARTING_TOWN.md's gap row). Where they would be:
  Pawson and Buisseret (STL-PBB), the Jamaica Archives inventories (STL-EHS), colonial building accounts.
- **Independence:** every validation above that is not "none needed" needs a check unit written by a different
  model than the code's, and the registry keeper's re-audit (PLATFORM §11a qualification).

## 4b. Building decay by material class (SET-20; review R-2 accepted the structure, 2026-10-30)

The interim aggregate of overlap group DUP-9 (owner later: Physical Reality's materials mechanism, Phase 9; then
these numbers become its validation data). Conditions of R-2: rates are data, labelled, from sources; exposure is a
host-supplied class, never weather computed here; the band shape and output factors stay level 5; an unsourced
class is null and flagged.

**Model (level 5, flagged).** A building carries an optional `decayClass` (host data). The class gives
`yearsToRuin`, the years from condition 1 to the ruined band without any repair. The four bands keep today's shape
(400 : 300 : 150 of the time in fine, sound and poor), scaled so the whole run takes `yearsToRuin x 365` days. A
host exposure class multiplies the time (`exposure: { [class]: factor | null }`, `sheltered` = 1). **A building
with no class, a null class or a null exposure factor does not decay** and is listed by a query
`unvalidatedDecay()`. That replaces today's unsourced 850 days with no decay rather than with another guess.

**The assumption joining evidence to model (level 5):** a building's years to ruin is the service life of its
shortest-lived envelope component, the roof. The sources give service lives under normal upkeep, not decay
after neglect, and no source read gives the rate at which walls fail once the roof is gone. Both are open.

| Class | yearsToRuin | Range in sources | Label | Sources |
|---|---|---|---|---|
| `palm-thatch` (timber or wattle walls, palm roof) | 5 | 4 to 10; 4 on a salt-wind Caribbean coast; 5 to 8 for coconut palm | estimate (secondary: an academic abstract, vendor and operator reports) | APCC journal abstract on coconut palm wood shingles (https://apccsec.org/journal-sub/index_php/journalicc/article/view/238); InspectAPedia, thatch roofs (https://inspectapedia.com/roof/Thatch_Roofs.php); Forever Bamboo, thatch FAQs (https://blog.foreverbamboo.com/7-thatch-faqs/) |
| `reed-thatch` (straw or reed roof, temperate) | 25 | longstraw 15 to 25; combed wheat reed 25 to 35; water reed 25 to 40 | estimate (secondary: insurer and property guides) | Jensten Insurance, how long a thatched roof lasts (https://jensteninsurance.co.uk/how-long-does-a-thatched-roof-last/); Rightmove, thatched roofs (https://www.rightmove.co.uk/news/?p=57178) |
| `wood-shingle` (timber walls, shingle roof) | 25 | 20 to 30 | estimate (secondary, modern inspection charts) | InterNACHI life expectancy chart (https://www.nachi.org/life-expectancy.htm); Roof Predict, roof lifespans (https://roofpredict.com/resources/how-long-does-a-roof-last) |
| `tile-or-slate` (masonry walls, tile or slate roof) | 50 | over 50 for the roof; brick walls 75 to 100 or more | estimate (secondary, modern charts) | InterNACHI chart and its Florida chart (https://www.nachi.org/florida-life-expectancy.htm) |
| `masonry` (brick or stone walls) | null | walls 75 to 100+ (modern charts); Spanish-era houses in Jamaica still standing over a century after 1655 (Edward Long 1774, via the Caribbean wattle-and-daub essay) | flagged: the roof decides, and a masonry building's roof class must be given | Long via Vanderbilt history blog (https://vugradhistory.wordpress.com/2020/05/14/the-legacy-of-wattle-and-daub-homes-in-colonial-caribbean-architecture/) |
| `wattle-and-daub` walls | null | "should last indefinitely" if maintained and sheltered; 700-year-old examples (conservation source) | flagged: no rate under neglect | Building Conservation, wattle and daub (https://Buildingconservation.com/articles/wattleanddaub/wattleanddaub.htm) |

Exposure classes: `sheltered` 1 (the definition of the class values); `salt-wind` null (the one figure, 4 years
on a Caribbean coast against 10 elsewhere for palm, is one operator's report: too weak for a factor, flagged).

**Validation:** VAL-D1 becomes a passing test once the unit lands: for each class with a value, days from condition
1 to the ruined band equal `yearsToRuin x 365` within 1 %, and each value lies inside its source range.
**Open:** the post-roof wall decay rate; a period (not modern) source for timber in the tropics with termites;
the exposure factor. They go to Physical Reality's materials work (DUP-9) and, where a class stays empty for a
game's buildings, to Rex.

## 5. Gates

Every settlement belt unit from 2026-10-30 carries a validation spec in its Gate: the suite includes
`test/validation.test.ts` (the V and VAL rows above, written by unit 2645), and a unit that changes a modelled
number adds or updates its VAL row. A VAL row that cannot pass yet is an `it.todo` naming its SET issue, never a
loosened tolerance.

## Log

| Date | What |
|---|---|
| 2026-10-30 | Written under Rex's V&V directive (PLATFORM.md §11a); SET-20 (decay fails plausibility) recorded; validation tests queued as unit 2645 |
| 2026-10-30 | §4b: decay by material class, the registry keeper's review R-2 accepted in structure; class table sourced and labelled; unit 2646 queued |
