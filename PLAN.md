# Settlement: PLAN.md (settlement keeper, draft 2026-11-02, to PLAN-SPEC; not approved)

Engine: `E:/AI Programs/Toolchain/settlement` (`@rex/settlement` v0.1.0 = d21c26d). This file replaces, as the one plan,
README "Built so far", PACKAGES, MIGRATION (12 steps), TESTS, QUESTIONS, VALIDATION and the planning parts of
CONTRACTS; those stay as reference and are cited by file and section. Amended 2026-11-02 after the outside review
(Rex via paste: ten lanes ST-1 to ST-10, checkpoints CP-1 to CP-5, the refinements he adopted; §8). Origin tags used below: **[B]** from a body
(Life's capacity and fatigue), **[M]** from a mechanism in code, **[H]** a host, fixture or config value.

## Pass 1 (one page)

**Mechanisms present (code):** daily tick of seven steps `src/tick/index.ts:10` (decay, projects, staffing,
production, wages, publicWorks, expiry). Production `Q = floor(min(equipment, labour, materials, utilities))` per line
`src/tick/production.ts:49`, lines share labour in order `:52, 59`, Q20 guard `:50`. Staffing from LabourSupply grants
`src/tick/staffing.ts:19-23`. Construction projects: materials all-or-nothing, then person-hours from a pool
`src/tick/projects.ts:12-28`. Decay by material class `src/tick/decay.ts:10-19`. Wages per filled post, rents per lease,
public-works wages from the treasury `src/tick/wages.ts:5-18`. Money through kernel `transfer()` `src/context.ts:66-94`,
`src/money-ledger.ts`. Titles, leases, assignments, offices, permissions, parcels, layouts: rules of record
(`src/commands.ts`).

**Mechanisms missing:** any output of *work done* to a body (hours worked never reach Life; M2's break). Task
intensity per recipe (no MET or power anywhere in Settlement's chain). A destination for construction materials
(`projects.ts:14` takes them from stock into nothing). Decay and demolition return no mass (M4). Taxes and any treasury
inflow (`wages.ts:22-25` is a no-op). Land use, cemeteries, sanitation (PACKAGES §8, Q16-Q18). Map derivation (MIGRATION
step 3, Q1). Shared-capacity accounting: equipment is recomputed per line and never decremented (SET-46). Material
holds and one time budget per person across passes (SET-50).

**Quantities owned:** building condition [0,1]; account balances (money, per currency; conserved by transfer);
ledger rows; titles, leases, posts, assignments, projects (labourHours, progress in person-hours), offices,
permissions, parcels and layouts (records with invariants); the day's production record (units per line).

**External inputs, with origin:** post hours per day [H]; person hours `LabourSupply.hours` [H in the pirate adapter;
partly intention-backed in Life's `labour-intentions.ts`, not capacity-backed]; pool persons = adults x health x (1 -
sick share) [M, `realism.population.labour`, health a host value]; `hoursPerDay` 10 [H, config.ts:39, SET-12];
`productivity` [H skill table]; recipe `labourHoursPerUnit`, `unitsPerFixtureDay` [H, Economy recipe data]; materials
on hand [M, Economy stock]; utility capacity [H, stub Infinity]; condition output factor [H, level 5]; years to ruin [H,
secondary sources, level 5]; wages and rents [H, `setWage`]; office powers [H, Government later].

**Outputs:** units produced per line (to Economy's stock through `materials.produce`), money transfers and ledger rows
(kernel ledger `settlement.money`), events (`postFilled` with cause, statuses, wagePaid, rentPaid), `SettlementReader`
(CONTRACTS §4b).

**Contribution to M1a (ST-1 only):** records, no code. The larder's place is the household's residence building
(M1a-08). A household id is an account holder (M1a-14). A right of use is a recorded permission, never physical
access: location and reach are Reality's, beliefs about them Cognition's, membership Society's. Settlement computes no
consumption, and no payment is in M1a.

**Flagged assumptions:** Leontief Q (level 4, no competing model tested); in-order labour sharing (Q15); 10 h day
(Q10/SET-12); decay bands and output factor (level 5, SET-20); project labour role fixed as `'labourer'`
(`projects.ts:22`); project wages paid to the pool's account, not to persons (`projects.ts:24`); payer may go negative
(Q19). Confirmed defects that block correctness claims for their paths only (not M1a): shared equipment allocated to every
line (SET-46), a stalled repair stops decay (SET-47), materials taken before the permit with no destination (SET-48,
SET-44). Floor discards divisible output (SET-49).

**Next dependency-ready task (once Rex lifts the stop):** queue hygiene only: `--recheck` 5069 and 5266 (work landed,
4a9d127 and ae9d06f), retire 2681 and 5070 as superseded (SET-41). The first build task is S2-a below (a work-done
record), and it waits on Life's PLAN naming the capacity and fatigue inputs it accepts.

---

## Pass 2: the full plan

Confirmed defects carry a reproduction (file:line). Risks are labelled **risk**. Open items keep their ids: Q-numbers
are in `QUESTIONS.md`, SET-numbers in `HQ/handoffs/settlement/ISSUES.md`.

### 1. Purpose and boundaries

**Settlement determines** who holds, uses and occupies land and buildings, and who works where. It also decides
whether a business can run on a given day, how many units each production line may make, how construction
advances, how buildings lose condition, and every money movement between its accounts. Most of that is rules of
record (VALIDATION §1). The numerical models are few: the production constraint, the labour and equipment caps,
construction labour, and decay.

**It receives:** labour supply and availability (Life, through the host's `LabourSupply`, CONTRACTS §16, §18, §21).
Recipes, rates and stock (Economy, `MaterialProvider`, CONTRACTS §4a, §13a). Utility capacity (host). Prices (Economy,
declared but unused, SET-9). Office powers (Government, `AuthorityProvider`, CONTRACTS §17, government DESIGN §2.3).
Currencies (CONTRACTS §22-23). Hires caused by intentions (the host's work resolution, `shared.host.work_resolution`,
CONTRACTS §19).

**It must never calculate:** energy, fatigue, health or capacity of a person (Life). Individual skill (Cognition; Knowledge reports holders and method requirements). Whether a person wants to work, and
what anyone believes about titles, residence or access (Cognition: Settlement publishes, Cognition believes). Physical
location, reach, locks and travel (Reality). Prices, wage levels, recipes, inputs and outputs, or stock (Economy). Law, tax,
succession or office powers (Government, SET-33). Organisations and kinship (Society, SET-34). Weather, material
physics or structural loads (Reality; decay is an interim stand-in, DUP-9). Story, alignment, or any `port.*`/`sec.*`
meaning (the pirate plugin, MIGRATION "What each step must not do").

### 2. State

| Quantity | Unit, range | Meaning | Kind |
|---|---|---|---|
| `Building.condition` | 0..1 | physical state of the fabric; bands fine ≥0.8, sound ≥0.5, poor ≥0.2, ruined (config.ts:22-25) | state with an update rule (decay down, repair up); not conserved |
| `Account.balance`, `.balances[currency]` | money, any real (negative allowed, Q19) | money held | **conserved**: Σ balances constant except `credit`/`debit` (boundary inflow and outflow, money-ledger.ts:1-2) |
| `ledger[]` (Transaction) | rows | deeds and payments, append-only | invariant: append-only; each money row is one kernel transfer |
| `Title.holder`, `Lease`, `Assignment`, `Office`, `Permission` | records | ownership, tenancy, residence and employment, offices | invariants: one holder per title; a sale changes only the holder (U3); assignments never self-end (U4) |
| `Parcel.footprint`, `Building.footprint`, `Layout` | tiles (Rect) | geometry | invariants: split children tile the parent exactly; layouts change only through projects (Q8) |
| `Post.hours` | h/day, ≥0 | hours the post *asks for* (demand, not supply) | host data (Q10) |
| `Post.wage`, `Lease.rent` | money/day, ≥0 | pay and rent levels | host or Economy data (`setWage`) |
| `Post.filledBy` | person or pool id, or null | today's resolution | derived each tick |
| `Project.labourHours`, `.progress` | person-hours, ≥0 | work required and done. **Confirmed doc defect:** `state.ts:181` comments `progress` as worker-days; the code adds hours (`projects.ts:25`) | counter, rises only |
| `Project.materialsDrawn` | bool | materials taken all at once | flag |
| `Business.status` | dormant / staffed / producing | one writer per tick (SET-21) | derived |
| `production[biz]` | units per line per day, plus the four caps | the day's output record | record (the goods themselves are Economy's) |
| `settlement.day` | days, integer ≥0 | the engine clock (kernel ms = day × 86 400 000, context.ts:74) | counter |

### 3. Mechanisms (each a calculation chain)

Origin of each number: **[B]** body (Life), **[M]** mechanism, **[H]** host, fixture or config. "→ X" names the engine
that should produce it eventually.

**3.1 Staffing** (`settlement.business.staffing`, staffing.ts). Inputs: `post.holder`; `post.hours` [H → stays
demand; Q10]; `LabourSupply.draw(pool…)` for pools; `available(person)` and `hours(person, role)` for named
people [H in the pirate adapter, stub Infinity at providers.ts:126. Life's `labour-intentions.ts` answers hours from
the latest work intention, still not from capacity → **Life [B]**: the hours a body can work that day after fatigue and
illness, gated by Cognition's intention]. Named hours are netted across posts by Settlement (CONTRACTS §21,
staffing.ts:21-23). Output: per-post granted hours (transient, staffing.ts:7) and the set of staffed businesses (open,
someone in charge, every required post filled). Stops applying when a holder is a crew or ship (the host says unavailable).

**3.2 Labour cap** (`settlement.production.labour_cap`, production.ts:24-27, 45). `labourHours = Σ granted hours ×
productivity(holder, role)`. Granted hours come from 3.1. `productivity` is [H] (a skill-band table), a labelled stand-in.
**Simplified (Rex via paste, 2026-11-03): no universal productivity formula.** At aggregate resolution `Q_labour = H_eff / h_per_unit`,
`H_eff = Σ_i h_i · φ_i,task`: `h_i` actual allocated hours (3.1, later Kernel reservations), `φ_i,task` a declared
task-specific factor (today `labour.productivity(holder, role)` [H]), `h_per_unit` the recipe's reference requirement.
No further health, fatigue or skill multiplier is added when the supplied rate already includes that effect. For an
individually resolved physical task, progress comes from the Reality–Life task model (3.7) and the aggregate formula
is never run over it again: two declared resolutions of the same work. DC-14's inputs (Life capacity and effort,
Reality demand, Knowledge method, Cognition skill) enter φ or the task model, each once; they are not composed into
one multiplier here. Life receives actual elapsed activity, never `H_eff`. Test: better skill may raise output, never
elapsed time, and never multiplies bodily expenditure by the same factor. Today's code already has this form. **Risk** of a triple penalty: `realism.population.labour`
already applies health, Life will apply fatigue, and a host could also lower productivity. `Q_labour =
labourHours / rates.labourHoursPerUnit`. The rate is [H] Economy recipe data (ECON-5) → **Economy** recipe (technique),
with the physical work per unit from **Reality** mechanics at body resolution. Effective hours are an aggregate approximation (level 4): `labourHours` is never sent to Life as elapsed time, since a productive worker
does not live extra hours. `T = W / P` applies only to a task represented as a given mechanical work at constant
delivered power. It does not cover holding a load, waiting on a process, precision work or interrupted work, and it
does not replace the stand-in table as one universal equation. At aggregate resolution the recipe's hours per unit stay. Lines share in order
(production.ts:52, 59), Q15.

**3.3 Pool supply** (Life and Reality, read here). `persons = adults × health × (1 − sick share)`,
`personHours = persons × hoursPerDay` (`realism.population.labour`, providers.ts:9-11) [M, level 4; health and sick
share are host values → **Life** health state; cohorts → **Society** (DUP-41)]. `hoursPerDay = 10` (config.ts:39) [H;
the period figure is 11, Voth, SET-12] → a working-day norm (**Society** or culture), bounded by Life's capacity and by
daylight (**Reality**). Pools that share a category throw (SET-31).

**3.4 Equipment cap** (`settlement.production.equipment_cap`, production.ts:34-44). For each fixture kind a line needs:
`Σ fixtures in usable premises × outputFactor(condition band) × unitsPerFixtureDay`, then the minimum across kinds.
Fixture counts are [M] (Settlement records, changed by projects). `unitsPerFixtureDay` is [H] Economy recipe →
**Economy/Reality** (equipment throughput). `outputFactor` 1, 0.9, 0.6, 0 is [H, level 5, no source] → **Reality**
materials and mechanics (DUP-9). **Confirmed defect (SET-46):** the equipment allowance is recomputed for each line from the
same fixtures and never reduced (production.ts:34-43), so two lines, or two businesses whose premises share a
building, each get a machine's full daily capacity. The rule needed is `Σ_ℓ u_ℓr ≤ C_r` for every shared resource r,
with use and capacity in one declared unit and interval (ST-5). Allocate machine time (fixture-days, the declared
operating interval, until a recipe gives hourly rates), then convert each allocation by its recipe's rate:
`Q_equipment = r_equipment,task · T_allocated`, so two products may need different machine time (5556).
**Building condition is not a universal machine penalty (Rex via paste, 2026-11-03):** a worn roof need not slow every machine. The band
`outputFactor` stays only as an explicitly selected coarse approximation (config `equipmentCondition: 'band-factor'`;
default `'none'`, SET-54). Building damage reaches operation through a named consequence (lost shelter, unusable
workspace, power cut, damaged machinery) once that consequence is modelled; no smooth multiplier replaces the table.

**3.5 Materials cap and utility cap.** `materials.available(inventory, recipe)` [M, Economy stock: the floor of inputs ÷
recipe units]. `utilities.capacity(building, recipe)` [H; stub Infinity, providers.ts:145] → **Reality** (water,
light, heat), and Settlement's own sanitation and infrastructure records once Q17 is designed.

**3.6 Production constraint** (`settlement.production.constraint_Q`, production.ts:49). `Q = max(0, floor(min(Q_eq,
Q_lab, Q_mat, Q_util)))`, Leontief, level 4. Q20 guard: a non-finite Q throws before any produce, in a check-only
prepass (production.ts:11-12, 50). Output: `materials.produce(inventory, recipe, Q)`. Economy transforms the inputs
into outputs in its own stock (a transformation Economy owns, not a Settlement transfer). Then `labourHours −= Q ×
hoursPerUnit`, and the day's record and status are written. Stops applying when the business is dormant or closed, or
its premises are demolished. Every cap must be in the same output unit and interval. Allocation order is a
declared rule: today, in order of `biz.lines` for labour only (Q15). It must be stable, recorded in the day's record and
applied the same way to every shared resource; then the same inputs give the same outputs. "Prior commitment first" is a
policy for Rex under Q15, not a correction. **Divisibility (SET-49, decided (Rex via paste, 2026-11-03)):** no unconditional floor. Divisible output keeps
fractional quantities; discrete products complete whole units and keep the unfinished remainder as a work-in-progress
record (no finished goods early); batch processes follow the recipe's batch rule. Each recipe declares which
(Economy recipe field, in the CONTRACTS section with Economy, 5557). Test: an interrupted task keeps its recorded
progress without creating finished goods.

**3.7 The M2 link that does not exist yet: work done → body (ST-3, ST-4).** Today the chain ends at Q. The plan:

1. **One time budget per person or cohort (SET-50).** One agreed **scheduling owner** holds the time reservations of
   every actor across all activities: work posts, construction, production intervals, and also travel, eating and
   sleep outside Settlement. Its inputs: Life supplies the bodily bound (`h_available` and capacity), and Cognition
   supplies intended participation. Neither owns the schedule because it supplies a limit. **Owner: Kernel (controller ruling NP-17, 2026-11-02; Rex may override)**,
   as a generic reservation ledger beside `transfer()` (scheduling is already its infrastructure, and the ledger holds
   no domain formula). INTEGRATION-PLAN M2-14 and NP-17. Agreed amendments (KRN-51, kernel PLAN §3.12, lane L5, step K7), which bind how
   Settlement's passes call it: (a) intervals are half-open, in integer ms of SimTime; nothing is reserved before now
   (T); release and fulfil act only on [max(at, T), end), and the part before T is recorded as fulfilled or lapsed.
   (b) The ledger is part of the kernel transaction, so a reservation made in a tick that throws is undone with
   Settlement's state. (c) A reservation is refused only when concurrent shares would exceed the actor's bound series
   (supplied by Life and Cognition); a missing bound is recorded as unbounded, never given a default, so Settlement
   must not substitute `hoursPerDay` for it. (d) Time is not a conserved stock: the L5 checks apply, not account
   reconciliation. Every reservation Settlement makes carries a cause (the post, project or intention id). Every Settlement pass reserves in that one system, and
   releases return to it. That replaces CONTRACTS §21's client-side netting, so it needs a new section with Economy and
   the scheduling owner.
   Over an interval, `Σ_j h_reserved,ij ≤ h_available,i`. The categories are mutually exclusive parts of one
   reservation: **elapsed active** (work happened), **idle committed** (on duty, no task), **released** (handed back
   before it elapsed). A release cannot restore time that has already passed; later scheduling uses only the remaining
   feasible interval.
2. **Bounded work intervals.** attempt → physical progress (Reality's task demand) → bodily response (Life) → continue,
   stop or interrupt, over intervals the coupled models support. A daily step is allowed only as a labelled
   approximation where capacity cannot change materially within the day. Committed progress survives an interruption.
3. **The activity record** (Settlement emits it; Life consumes it once): `{ cause id (unique), person | cohort, task kind
   (named by the recipe or project), start, end (elapsed duration), progress achieved, post or project }`. It carries
   elapsed time, never effective hours. Whether idle committed time costs the body anything is Life's call (SET-42).
4. **M2-04b (controller 2026-11-02; Rex may override; closes SET-43):** a recipe names its task kinds (Economy data);
   Reality owns each task's mechanical demand (force, power, duration profile); Life computes effort = demand ÷ capacity,
   then MET, energy and fatigue, and books them once. The three fatigue mechanisms in realism need Life's reconciliation.
5. Capacity after the interval answers the next reservation. The loop closes: work → fatigue → capacity → hours →
   output.

**3.8 Construction** (`settlement.project.construction`, projects.ts). Materials all or nothing from
`Project.inventory` (`have`, then `take`, :12-17). Then, once a required permit is held, `draw(pool, 'labourer', null,
wanted)` (:22). Progress counts person-hours; the project completes when `progress ≥ labourHours`, which mints or
changes a building. `labourHours` is [H] per project → **Reality** construction mechanics (material quantity × technique)
and **Knowledge** (technique); VAL-C1.
- **Confirmed:** the role is the fixed string `'labourer'` (projects.ts:22), so no host can ask for carpenters.
- **Confirmed** (SET-44): taken materials leave Economy's stock with no destination record (projects.ts:14). A
  building has no material content, which breaks PLATFORM §7a and blocks M4.
- **Confirmed** (SET-48): materials are taken before the permit check (projects.ts:12-19), so a project with no permit
  empties the stock and then waits.
- **Material states (ST-6):** available → **held** → delivered → installed fabric, recoverable remainder or declared
  waste. A hold is an encumbrance with its own id: `Q_available = Q_on_hand − Σ_r Q_held,r ≥ 0`. It changes
  availability, not mass or location, so held material stays in the original inventory's mass, and the hold is not a
  second physical account. Reserve, release and fulfil are explicit operations; fulfilling consumes the hold and runs
  the stock change atomically. Delivery is a transfer into project stock; installation is a transfer into the
  building's fabric. Economy keeps the holds on its stock lines. Mass balance over whichever boundary is declared:
  `M_initial + M_in − M_out = M_final`. Demolition is not assumed to return everything as reusable material. A
  simple project-material account is needed as soon as construction runs, not at M4.
- **Confirmed** (SET-45): the project wage goes to the pool's account (`pay(entry.account, entry.pool, wage × hours /
  hoursPerDay)`, :24), not to the persons who worked. It is priced per worker-day through `hoursPerDay`, while post
  wages are a flat amount per day (wages.ts:11).
- **Staged work (Rex via paste, 2026-11-03):** a project is stages (for example foundation, framing, roofing), each with its
  requirements and dependencies. Per step `ΔP = min(P_required − P, Σ_i h_i · φ_i,stage)` in reference labour-hours,
  applied only while the stage's materials, equipment and participation are available. An aggregate approximation, not
  a claim that any number of workers can work together: each stage declares its crew or workspace limit. Material path:
  inventory → project stock → installed material, remainder or waste; reservations reduce availability and move no
  mass. Tests: interruption keeps completed work and delivered material; cancellation accounts for the remaining
  material; two projects cannot reserve the same stock.

**3.9 Decay** (`settlement.building.condition_decay`, decay.ts:10-19). **Simplified (Rex via paste, 2026-11-03), SET-55:**
one declared rate per represented component, `c(t+Δt) = max(0, c(t) − d·Δt)`, `c ∈ [0, 1]` a defined service-condition
index, `d ≥ 0` per unit time, matching units. Today's classes are roof service lives (config.ts:27), so the one
component is the roof: `c ← max(c_end, c − d_roof)`, `d_roof = (1 − c_end) / (yearsToRuin × 365 × exposure)` per day,
`c_end` the bound where `ruined` begins (0.2 today), so the endpoint "end of roof service life" is entering `ruined`
(5617). A labelled approximation that never predicts structural collapse. Bands stay as display labels; the band shares
400:300:150 of 850 (config.ts:37) [H, level 5] are retired. `yearsToRuin` per class [H, secondary and modern sources,
VALIDATION §4b]; `exposure` sheltered 1, salt-wind null [H]. Missing data is reported as unsupported
(`unvalidatedDecay()` and the run record), never read as immortality. Further components only when a modelled
consequence needs them (roof → shelter). Tests: one step and subdivided steps agree; a stalled repair gives no
protection; missing data is reported. **Confirmed defect (SET-47):** any active repair project suspends all decay (decay.ts:6-9), even with no materials
or labour, so a stalled repair makes a building immune. Fix: decay runs whatever projects are open. Only modelled
repair work, or a modelled protective action, changes condition. No proportional reduction and no decay floor: neither
has a source. Completed repair restores condition per the material model.
→ **Reality** materials and weather (DUP-9); then these numbers become validation data. SET-20, Q1b. The output feeds
3.4 only where a host selects the band factor (SET-54).

**3.10 Wages and rents** (`settlement.wage.pay`, `settlement.property.lease`, wages.ts:5-18). Each filled post with a
wage above 0 pays `post.wage` [H, `setWage` → **Economy** `economy.labour.wage_quote`, CONTRACTS §16, §19]. The
business pays, or the treasury holder for public works. Each active lease pays `rent` [H → Economy, a market; VAL-R1]
to the title holder. Every payment is one kernel transfer (context.ts:66-94). Balances may go negative (Q19). **Contract forms (ST-8):** a fixed daily wage, `W = r_h · h_payable`, and `W = r_q ·
Q_accepted` are all valid. Economy supplies the rates; Settlement applies the agreement a post or project declares.
Payable hours need not equal active hours. Today posts pay a flat daily wage, and projects prorate through
`hoursPerDay` and pay the pool (SET-45). That difference is accidental until a declared contract form names it. Posts (fixed per period) and projects (hours)
stay distinct, each declared, not forced into one formula; paid time may include waiting or attendance (Rex via paste, 2026-11-03).

**3.11 Treasury** (state.ts:12, 230-233). The treasury is account `acct.0001`, holder `town`: its own account (Q7
default; `port.cash` stays a story key). Outflows: public-works wages. Inflows: only explicit `credit` commands. No tax:
`publicWorks` is a no-op hook (wages.ts:22-25) → **Government** (tax, spending, SET-33). Nothing is invented here.
**AGREED with Government, 2026-11-02 (SET-52, SET-53; text staged at `HQ/handoffs/government/GOVERNMENT-SETTLEMENT-section-may-holds.md`, landed in both repos by Government's composer copy unit after the stop; code is a Settlement unit after that):** `may` returns `yes`, `no` (with a
reason) or `unknown` (with its reads). `unknown` refuses with `authority unresolved: <reads>`: it is never permission and
never recorded as a denial, and no pending queue is kept. The default provider returns only yes or no, so the run stays
byte-identical. **Funding holds (GOV-31)**, owned by Settlement: `hold`, `release`, `settle(ref, payee, amount?)`;
per currency, available = balance − Σ holds; a hold above available is refused; settle is one transfer; holds are
encumbrances, not money rows, and roll back with the transaction. Unheld payments keep Q19's no-refusal behaviour.

**3.12 Rules of record** (commands.ts): land split and merge, titles (sale, transfer, inherit with the heir named by
the caller), leases, assignments, offices, permissions, expiry (expiry.ts). These are rules, not equations, verified
by U1-U12, A1, A2.

**3.13 Money transfer** (`settlement.ledger.pay`). `Δsource = −q`, `Δdestination = +q` in one `transfer()` on ledger
`settlement.money`. The goods leg of a sale goes in the same batch (CONTRACTS §20, U26). N legs and currencies follow
CONTRACTS §22-23 (U27). A failed batch rolls back atomically. Per currency c, over the declared boundary: `Σ_a ΔB_a,c = inflow_c − outflow_c`.
`credit` and `debit` are the boundary rows. Balances in different currencies are never added without an explicit
conversion transaction. Open on the ST-2 card: monetary precision and rounding (plain JS numbers, `finite` checks
only: SET-51); whether a negative balance is authorised credit, what happens when a payment cannot be made, and
whether an unpaid obligation stays outstanding (all Q19). The transfer identity is exact; unlimited borrowing is a
behavioural assumption.

### 4. Inputs and outputs

| Quantity | Producer → consumer | Unit, range | Timing | Failure and rollback |
|---|---|---|---|---|
| hours, available, draw, productivity | Life (host `LabourSupply`) → Settlement 3.1-3.2 | person-hours ≥0; factor ≥0 | each tick, staffing step | pure queries (§17); a throw aborts the tick; reduce clones state, so Settlement rolls back |
| rates, available | Economy → 3.2, 3.4, 3.5 | units/fixture-day, h/unit; units | each tick, per line | pure; non-finite → throw (`finite`) |
| produce, take | Settlement calls → Economy writes stock | units | production and projects steps | **not transactional**: a later throw leaves Economy's stock changed (SET-15; the kernel's snapshot-and-restore closes it) |
| capacity | host → 3.5 | units/day | per line | pure |
| may(office, power) | Government → commands | `yes` / `no`+reason / `unknown`+reads (SET-52) | per command | pure (§17); unknown refuses distinctly, never permits |
| funding holds | Government appropriations → Settlement holds | money per currency | hold, release, settle | settle is one transfer; holds roll back with the transaction (SET-53) |
| money transfers | Settlement debits and credits | money | wages, rent, pay, projects | kernel `transfer()`, atomic |
| goods leg of a sale | Economy ledger, in Settlement's batch | units | `pay` with goods | atomic with the money leg (§20) |
| `SettlementReader` | Settlement → Economy | records | any time, read-only | pure over state |
| events (`postFilled` with cause, statuses, wagePaid, rentPaid) | Settlement → host bridge, Cognition (`shared.action.outcome`) | events | per command and tick | returned with state |
| **work record (new, 3.7)** | Settlement → Life | person-hours per person, role, task kind | end of the production step | proposed; contract with Life, SET-42 |
| **materials into fabric (new, 3.8)** | Economy stock → building record | units | project draw | one transfer per flow; SET-44 |
| **material holds (new)** | Economy keeps holds; Settlement reserves, releases, fulfils | units per stock line | project start, delivery | fulfil is atomic with the stock change; release on cancel |
| **time reservations (new)** | Kernel holds them (NP-17); Life bounds them, Cognition intends; every Settlement pass reserves | person-hours per interval | staffing, projects | released unelapsed time returns; elapsed time never does |

**Who debits and who credits each flow:** money: Settlement, both sides. Goods made: Economy (a transformation). Goods
taken for construction: Economy debits, and the credit is missing today (SET-44). Body energy for work: Life only;
Settlement never books it.

### 5. Evidence

| Parameter | Value | Label | Source |
|---|---|---|---|
| Ledger identity | Δ = ∓q | measured (accounting identity, level 1) | VALIDATION §2 |
| Leontief Q | min of caps | assumption (level 4) | the brief; competing CES or Cobb-Douglas untested |
| hoursPerDay | 10 | assumption; 11 is a calibrated estimate | Voth, JEH 1998 (STL-VOTH), SET-12 |
| pool persons formula | adults × health × (1 − sick) | assumption (level 4) | realism, `realism.population.labour` |
| productivity | 1 by default | assumption | host table |
| recipe rates | per recipe | Economy's labels | ECON-5 |
| output factor | 1, 0.9, 0.6, 0 | assumption (level 5) | none |
| decay shares | 400:300:150 | assumption (level 5) | none |
| yearsToRuin | thatch 5, reed 25, shingle 25, tile 50; masonry and wattle null | calibrated estimate (secondary and modern) | VALIDATION §4b |
| construction labour | per project | none yet; VAL-C1 brackets ~500 h to a crew-year | Colonial Williamsburg; NAHC 1630s contract; Rundlet-May 1807 |
| wages | labourer 2s, journeyman 4s, master 6s a day | calibrated estimate, ±50 % | STL-MOR, ECON-THO, STL-NAV (STARTING_TOWN.md) |
| rents | 0.25s to 1s a day | calibrated estimate, weak | 1685 lot valuation; Blome |
| shop staffing | 1 to 3 hands | calibrated estimate | STL-PHIL |
| MET per activity (proposed, 3.7) | per activity | measured | Ainsworth et al. 2011 Compendium (for Life to adopt) |

### 6. Status

| Mechanism | Designed | Implemented | Connected | Numerically checked | Validated |
|---|---|---|---|---|---|
| ledger.pay (kernel transfer, currencies, goods leg) | yes | yes (4a9d127, 898243b, ae9d06f, 8d0c454) | yes (Economy LedgerProvider, kernel) | yes (V1, U25-U27) | n/a (identity) |
| rules of record | yes | yes | pirate T1, A1, A2 | U1-U12 | n/a |
| staffing | yes | yes | Life provider partly (intentions, not capacity); hires via IF-27 (U24) | V2, U21 | n/a (rule) |
| labour cap | yes | yes | pirate I3b against `populationLabourSupply` (SET-30) | V5, U18 | no |
| equipment cap | yes | yes | Economy rates | V3 | no |
| constraint Q | yes | yes | Economy I1, I2 | V3, V4 | no (no shop-output series) |
| construction | partly (no fabric, fixed role) | yes | Economy take | V7, U16 | no (VAL-C1 after Q10) |
| decay | interim (R-2) | yes (79a848a) | none (Reality DUP-9 later) | VAL-D1 (verification only) | no, SET-20 |
| wages and rents | yes | yes | Economy quote §19 | U17 | no (VAL-W1, VAL-R1 after Q10) |
| treasury | records only | account only | none | U5 | n/a |
| work record → Life (3.7) | this plan | no | no | no | no |
| materials into fabric | this plan | no | no | no | no |
| land use, cemeteries, sanitation | sketch (PACKAGES §8) | no | no | no | no |
| shared-resource allocation (ST-5) | this plan | labour only (in order) | no | no; SET-46 confirmed defect | no |
| material holds, time budget | this plan | no | no | no | no |
| map derivation (MIGRATION 3) | worked example | no | no | no | no |

### 7. Validation

Kept from VALIDATION §2-§5 and TESTS (U1-U27, T0-T14, A1, A2, V1-V8):
- **V1** money conserved to the unit over 365 hamlet days. **V2** status is a pure function of the day's inputs.
  **V3** Q never falls when a factor rises, and zero in any factor gives zero. **V4** an all-Infinity line throws and
  leaves stock unchanged. **V5** assigned hours ≤ supplied hours. **V6** condition stays in [0,1] and falls without
  repair. **V7** materials drawn = materials named.
- **VAL-D1** stays a verification test (days to ruin = yearsToRuin × 365 ± 1 %). True validation needs a period
  rebuilding interval or Reality's materials model (SET-20).
- **VAL-W1** wages within ±50 % of the trade bands; **VAL-R1** rents within ×2; **VAL-C1** small-house labour within
  ×2 of 500 h to a crew-year; **VAL-S1** 1 to 3 hands a shop. All wait on Q10 starting data and are checked on that
  data, never on data tuned to pass.
- **Competing model (gap):** Leontief against CES on a period trade's daily output, ±30 %, when a source is found
  (Pawson and Buisseret, Jamaica Archives inventories).

New, for the milestones:
- **M2-P (paired):** one person, one post, one recipe with a declared activity, fixed seed, 30 days. *Provisioned:*
  food adequate; output per day stays within the recipe's range and Life's fatigue recovers each night. *Deprived:*
  food below need; Life's capacity falls through its declared states, granted hours fall, Q falls to 0 and the
  business goes dormant. Recorded, never tuned. Assert: reserved hours ≤ Life's available hours per interval; one Life
  expenditure row per activity record (by cause id); the record carries elapsed time, not effective hours; no
  productivity change from fatigue; an interruption keeps committed progress.
- **SET-44 balance:** materials taken = materials in the building's fabric; on demolition, fabric = debris returned
  (M4). Exact, mass by material.
- **ST-3 time:** one worker on two posts and one project cannot supply the same hour twice; a release returns only
  unelapsed hours.
- **ST-5 shared capacity:** two lines and two businesses on one machine together use at most its capacity; a shared
  utility likewise; a partial batch; a failure after an earlier line has changed inventory (SET-15); the same inputs
  in the same declared order give byte-identical output.
- **ST-6 holds:** two projects cannot hold the same 100 kg; a project without its permit draws nothing; cancellation
  sends delivered material to a declared destination; mass balance exact.
- **ST-7 decay:** a stalled repair leaves decay unchanged; demolition accounts for every material destination.
- **ST-8 pay:** partial attendance is paid by the declared contract form.
- **Replay** (U15) for each new record.

### 8. Build order: ten lanes, five checkpoints (review 2026-11-02, Rex via paste)

Each lane is a keeper card with seven items. Cards hold design. Code waits on the stop being lifted and on the
checkpoint's acceptance.

| Lane | Question | Boundary (never) | Model | Evidence | Functional test | Realism test | Connection test |
|---|---|---|---|---|---|---|---|
| ST-1 Places, occupancy, rights | Who holds, rents, resides in and may use each parcel and building? | location and reach (Reality), beliefs (Cognition), membership (Society) | rules of record, level 1 | Rex's rules (Q2, Q6); customs as host data (SET-11, SET-14) | U2-U4, A1, A2; a household's residence and larder location resolve | n/a (records) | IT-M1a-2, IT-M1a-7: a right of use never stands in for physical access |
| ST-2 Money and payments | Who pays whom, in which currency, exactly once? | prices and wages (Economy), credit policy (Q19; Government later) | double entry per currency; boundary rows | accounting identity | U25-U27; a multi-party payment commits once or rolls back; no cross-currency sum | n/a; credit is a separate assumption | Economy `LedgerProvider`, kernel transfer records |
| ST-3 Staffing and time | Which person-hours go to which post or project? | bodily bound (Life), intention (Cognition), the reservation ledger (Kernel, NP-17) | one budget per person or cohort in the shared reservation system (NP-17), reserve and release (3.7.1) | constraint, level 1; `hoursPerDay` SET-12 | the same hour is never supplied twice across posts and projects; concurrent shares never exceed the bound; elapsed time never restored; a rolled-back tick leaves no reservation | hours per day against Voth (SET-12) | Kernel's reservation ledger (NP-17) bounded by Life's `LabourSupply`; new contract section replacing §21 netting |
| ST-4 Task execution and bodily feedback | What work happened, for how long, with what progress? | demand (Reality), response (Life), skill and participation (Cognition) | bounded intervals; activity record (3.7.2-3) | Reality and Life models; daily step labelled level 4 | one activity record ↔ one Life row; interruption keeps progress; replay | M2-P paired run | IT-M2-1, IT-M2-2 |
| ST-5 Production and shared resources | How many units each line makes within shared capacities? | recipes and stock (Economy), utilities (Reality) | Leontief per line (level 4) with `Σ_ℓ u_ℓr ≤ C_r`; declared stable order (Q15); machine time allocated, converted per recipe; divisibility per recipe (SET-49) | no shop-output series (gap) | shared machine, shared utility, partial batch, mid-step failure | VAL-S1; competing CES model | Economy I1, I2 |
| ST-6 Construction and repair | How materials, labour and permits become fabric? | holds and stock (Economy), mechanics (Reality) | material states with holds (3.8); permit before draw; roles from the project | VAL-C1 sources | holds exclusive; no permit, no draw; cancellation destinations; mass balance | VAL-C1 | Economy holds (reserve, release, fulfil) |
| ST-7 Condition, deterioration, demolition | How condition changes; where demolished material goes? | material physics and weather (Reality, DUP-9) | one constant rate per component, roof first (3.9, SET-55); repair only by modelled work | VALIDATION §4b, level 5 | a stalled repair does not stop decay; demolition balance | VAL-D1 is verification; period interval needed (SET-20) | Reality materials |
| ST-8 Wages, rent, obligations | What is due under which declared contract? | rates (Economy) | contract forms (3.10) | VAL-W1, VAL-R1 bands | partial attendance per contract; post and project forms declared | VAL-W1, VAL-R1 | Economy wage quote (§19) |
| ST-9 Infrastructure and land use | What area, use and services each parcel gets? | water, power, light, soil (Reality); plants (Life) | `use` per parcel (Q18); service allocation within supplied capacity | PACKAGES §8; Q16-Q18, historical first | a field or workshop gets the correct area and service share | period sanitation (Q17) | Life plants, Reality soil and utilities |
| ST-10 Public accounts and institutional commands | Execute authorised appointments, treasury payments and other changes | decisions, tax, succession (Government); organisations (Society) | rules of record under `AuthorityProvider` | government DESIGN §2.3 | an unauthorised command is refused; a treasury payment moves once | n/a | Government (SET-33), Society (SET-34) |

| Checkpoint | Lanes | Scope | Decision (Rex via paste) |
|---|---|---|---|
| S0 (before all) | n/a | after the stop lifts: `--recheck` 5069 and 5266; retire 2681 and 5070; fix the `state.ts:181` comment (SET-41) | housekeeping |
| CP-1 Records | ST-1; ST-2 in parallel | residence, household account holder, rights apart from access. ST-1 alone supports M1a; ST-2's account and credit contract is reviewed alongside but is not an M1a prerequisite (no payment in M1a) | approve contract design |
| CP-2 One worker, one task | ST-3, ST-4 | allocate time, do bounded work, emit the activity record, update Life once, survive interruption. No payment | approve design; coordinate with Reality and Life |
| CP-3 Production and payment | ST-5, ST-8, ST-2 | shared-resource limits, material transformation, output, declared wage contract | acceptance held until SET-46 is fixed |
| CP-4 Construction and repair | ST-6, ST-7 | material destinations and holds, staged progress, roles, cancellation, justified condition change | acceptance held until SET-44, SET-47 and SET-48 are fixed |
| CP-5 Infrastructure and institutions | ST-9, ST-10 | land use (M3 parcel area to Life and Reality), utilities, deterioration and demolition (M4 debris), Government-directed transactions (M5) | planned |
| Plugin | n/a | MIGRATION steps 3-12; pirate work stays parked (PLATFORM §1); each step waits on its Q (Q1, Q3, Q5, Q6, Q7, Q10, Q11) | parked |

First cards: ST-1, ST-3 and ST-4, with ST-2's account and credit contract alongside; ST-5 next, for M2. The confirmed
defects block correctness claims for production and construction only, not the M1a bread fixture. The first
meaningful demonstration (CP-2) is one worker completing or interrupting a task, with time, progress and bodily cost
each recorded by its owner. Materials, output and payment are added at CP-3.

Simplification adopted (Rex via paste, 2026-11-03): keep the minimum-capacity production model and simple contract arithmetic;
task-specific progress at its own resolution (3.2); a labelled constant-rate component model for decay (3.9); no
universal building-condition machine penalty (3.4); staged construction (3.8). Deferred: detailed structural ageing and
a general productivity formula. The time, material and shared-equipment fixes stay required.

Not adopted from the review discussion, as its own verdict says: "prior commitment first" as the allocation priority
(a policy for Rex under Q15); a proportional repair reduction with a decay floor (no source).

### Open items (defaults in force; no box filled just to fill it)

| Id | What | Default |
|---|---|---|
| Q1 | footprint classes, household size, reserve share | the worked example's classes, proposed; blocks MIGRATION 3 and SET-10 |
| Q1b | material class and exposure per building | small buildings palm thatch; public buildings and salt-wind null (no decay) |
| Q5 | starting fixtures per place; `activeOnly` | proposed table in `rules.json`; `activeOnly: false` |
| Q6 | title holders, faction restrictions | FACILITIES s7 rows proposed; `transferable` per title |
| Q7 | is `port.cash` the treasury | no: the treasury is its own account |
| Q10 | posts, lines, wages, rents; hours per day | sourced figures where found, else placeholders; `hoursPerDay` 10 (period 11, SET-12) |
| Q15 | sharing a day's labour across lines, and (extended 2026-11-02) every shared resource: equipment, utilities | labour `in-order`, any other value throws; equipment has no sharing today (SET-46), proposed: the same declared order |
| Q19 | wage debt | no rule; a payer may go negative |
| Q20 | a line with every cap Infinity | throws before any produce |
| SET-20 | decay is a candidate model, not validated | interim class model; unclassified buildings do not decay |
| SET-42 | whether idle committed time costs the body anything | for Life to state |
| SET-49 | divisible output and work in progress under `floor` | rule decided 2026-11-03 (3.6); floor stays until Economy's recipes declare divisibility (5557) |
| SET-50 | one time-reservation system for every activity, held by Kernel (NP-17 ruled 2026-11-02; Life bounds, Cognition intends; a contract change from §21) | client netting inside staffing; pools netted by the provider |
| SET-51 | monetary precision and rounding | plain numbers, no rounding rule |
| SET-43 | owner of a task's physical demand | closed by M2-04b: Reality demand, Life effort |

Superseded by this plan: README "Built so far" as a plan (it stays as history); MIGRATION step 12's "PLAN.md unit beside
unit 37" (this file is the plan); VALIDATION §2's "after P1" notes (P1 has landed).
