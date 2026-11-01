# Integration-test specs (settlement keeper, 2026-10-29; proposed)

Specs, not code. Each names where it lives, what it sets up, what it does and what must hold. Package tests
(U) run with none of pirate-ship on disk; adapter tests (T, A) run in the pirate repo's `web/` under vitest
beside `src/alignment/`. Every number in a setup is a test fixture, not a game rule.

V4 and U17 are now strict: all-Infinity production throws before inventory changes, and wage writer sites must belong to `addPost` and `setWage` by name.

## The guard

**T0, alignment invariance** (adapter; written first, run at every migration step).
Setup: the alignment sim's existing scenarios (`web/src/alignment/sim/scenario.ts`), the settlement engine
loaded from `port.json` with stub providers. Action: fold each scenario's command log through the alignment
`reduce` as today, and in parallel drive the settlement engine through a scripted day between each alignment
command (a `sell`, a `lease`, a `hire`, a `startProject` + `advanceProject`, a `tick`). Must hold: after every
alignment command the `AlignmentState` JSON is byte-identical to a run without the settlement engine;
`townPosition`, `isPerfect` and `ending` are identical; the settlement engine never produced an alignment command
(the bridge's outgoing log is empty).

## Package tests (`Toolchain/settlement/test/`)

| Id | Rule under test | Must hold |
|---|---|---|
| U26 | atomic money and goods (`test/transfer-batch.test.ts`) | one transfer conserves both legs; goods refusal rolls back without logging; zero and fractional units work; opts stay outside the JSON log; settlement-only replay is exact; debt remains allowed (Q19 open) |
| U25 | kernel money transfers (`test/money-ledger.test.ts`) | wages and pay conserve money; rows, events and replay stay byte-identical; zero/self payments do not move balances; holders and money units are validated; debt remains allowed (Q19 open); failed batches restore accounts atomically |
| U1 | ids are stable and never reused | split a parcel twice, demolish a building, replay the log: the same ids come out; the retired parent id is still queryable and marked retired |
| U2 | one holder per title, many tenants | a `lease` on a leased title adds a second lease; a second `sell` of the same title is refused unless the first buyer is the seller |
| U3 | ownership is not control | after `sell(title of the shop building)`, `operator(biz)` and `manager(biz)` are unchanged; after `setOperator`, the title holder is unchanged |
| U4 | assignments are non-exclusive | one person holds residence (bldg A), employment (post in biz B), management (biz C) and membership (crew X) at once; `assignmentsOf` returns four; `unassign` one leaves three |
| U5 | the ledger is complete and money conserved | after a day with a sale, two wages and a rent, the sum of all account balances is unchanged and every balance change has exactly one `txn` row |
| U6 | `Q = min(equipment, labour, materials, utilities)` | four stub providers each capping one factor: output equals the smallest cap in each case; zero fixtures, zero filled posts, zero materials or zero utility each give zero |
| U7 | status is derived | no filled required post: `dormant`; posts filled, nothing produced: `staffed`; `Q > 0`: `producing`; physical condition does not change status |
| U8 | layouts persist and projects write them | `renovate` with a layout delta completes after its labour days: `layout.version` increments, fixtures match the plan, the previous version is retrievable; a cancelled project leaves the layout untouched; a reloaded JSON state has the same layout |
| U9 | construction mints and demolition retires | `construct` on a vacant parcel mints a `bldg.*` and sets `vacant: false`; `demolish` sets `demolishedOn`, keeps the title history, frees the parcel |
| U10 | authority is data | an office with `powers: [permit]` can `grantPermission`; one without is refused; a project whose `needs.permit` is true cannot start without one; appointment and vacancy are ledger rows |
| U11 | tick order | the seven tick steps run in the declared order (a trace lists them); a project completed in step 2 is staffable in step 3 of the same day, which is the stated behaviour, not an accident |
| U21 | one status writer, one event per change | the hamlet emits exactly one `businessStatusChanged` in ten days; a business that loses its only worker on day 5 emits exactly one more; only the production step writes `Business.status` in the tick (SET-21, REG-16) |
| U18 | finite person-hours | two businesses and a project share daily pool grants without exceeding supply; unsupported labourSharing names Q15 |
| U19 | conversion preserves results | U7, U8, U13, U16, A1 and hamlet production, wages and projects retain their expected numbers |
| U20 | inventory rebinding | setInventory validates the business and ref; the next tick consumes the new inventory |
| U17 | setWage is the only wage channel | over ten ticks `Post.wage` never changes and each day's `wage` row equals it; `setWage` changes it and the next row follows; `.wage =` is written only by `addPost` and `setWage` (Q19 open: may a payer go into debt) |
| U12 | the engine names nobody | every person id in a state came from a command; `LabourProvider.draw` returns pool ids, never a person the host did not register |

## Adapter tests (`Games/RPG's/pirate-ship/web/src/settlement/*.test.ts`)

| Id | Rule under test | Setup | Must hold |
|---|---|---|---|
| T1 | bindings cover the institutions | `institutions.json`, `bindings.json` | every slot with a non-null `port.*` id has at least one parcel and one building; every id in a binding exists in `port.json`; no engine id appears in `institutions.json`, `UPGRADES.md` or `TOWN_SHEETS.md` |
| T2 | the map is derived, not typed | `requirements.json`, `derive_map.py` output | every place's binding has at least its footprint class's tiles; every parcel touches a road or the harbour; undeveloped share within the requirement; changing the housing requirement changes the dimensions (the script is not a constant) |
| T3 | buying leaves the story alone | the player buys `port.bakery`'s building | `sell` succeeds, a `txn` row exists, `holderOf` is `player`; `AlignmentState` identical; `slot.owner` of `port.bakery` still `esfp-f`; the art key `port.bakery` resolves to the same tiles |
| T4 | transfer and inheritance are host-named | `inherit(title, 'farm-daughter')` for `port.farm` | the holder changes; no succession rule in the engine was consulted (the command carried the heir); `AlignmentState` identical |
| T5 | one owner, many tenants | the player owns the warehouse building; `bigwig`'s business leases rooms; a second business leases others | both leases coexist; rents reach the player's account; `operatorChanged` never fires |
| T6 | the facility boolean is derived | starting fixtures per building | `hasFacility('stl.port', id)` equals the hand list the economy data would have had, for all 25 ids, in the starting state; removing the only `forge` fixture flips `forge` to false |
| T7 | arrangements do not move the alignment engine (Q2 answered) | `intp-m` holds the farm's title and operates its business with a manager post filled by `farm-daughter` and two pool posts; then the alignment `recruit(intp-m)` | `CharacterState.location` goes to `aboard` exactly as today; every assignment of `intp-m` still exists; `LabourProvider.available('intp-m')` is false so his own post is unfilled that day; the business stays `staffed` and `producing` through the manager and the pool; `develop(port.farm)` behaves as today |
| T8 | unnamed workers come from the pool | a post with holder `pool.dist.housing` | `LabourProvider.draw` is called with the district's role counts from the POPULATION record; the wage row's `to` is the pool id; no character slug is minted |
| T9 | production is constrained | the butcher shop with 1 `salting-house`, 2 filled posts, 10 units of inputs, utility 1 | `Q` equals the smallest of the four; after a `tick` the inventory moved by `Q`; the business is `producing` |
| T10 | the brewery is optional and constructible | no brewery in `port.json` | `hasFacility('brewhouse')` is false at the start; after `construct` with `brewhouse` fixtures, Brewing posts and inputs, a Brewing recipe produces; nothing in `institutions.json` or `UPGRADES.md` was needed |
| T11 | renovation persists | renovate the butcher shop's interior (a new room, a fixture moved) | the layout version increments and survives save and reload; `port.bakery`'s binding unchanged; `AlignmentState` identical |
| T12 | parcels subdivide | split a farmland parcel; sell one child | the parent is retired, the children are new ids, the sale's title is the child's; `bindings.json` for `port.farm` still resolves (it lists the children or the retained child, per the adapter's split handler) |
| T13 | the mayor is an office in the town hall | `appoint(office.mayor, 'estj-f')` | the office's seat is `port.townhall`'s building; `sec.townhall` in `institutions.json` unchanged; a permit granted by the office appears in the ledger; `AlignmentState` identical |
| T14 | two readings beside the flag | a physically fine, economically dormant brewery; a ruined, producing butcher shop | `physical` and `economic` disagree as expected; `slot.developed` of every slot is what the alignment command log made it and nothing else |

## Acceptance (A1, adapter, the last test of the migration)

**Setup.** `port.json` starting state, `bindings.json`, stub providers (JSON inventory, POPULATION pool, utility
1, a flat price table), the alignment engine at `initialState` with the existing starts, thresholds, gates and
conditions. Record `S0 = AlignmentState`, `P0 = townPosition`, `E0 = ending`.

**Script**, each line a command, each followed by a `tick`:

1. `sell` the butcher shop's building title to `player` at the price table's value.
2. `transfer` that title to `farm-son` (kind: gift).
3. `lease` the building's rooms to a new business `biz.<n>` of kind `butcher` operated by `esfp-f`, managed by
   `farm-son`.
4. `addPost` x 2 (a `butcher` role, a `labourer` role); `hire` one to `esfp-f` by employment assignment, the other
   to `pool.dist.housing`.
5. `startProject` renovate: add a `smokehouse` fixture in a new back room; `advanceProject` until complete.
6. Supply inputs through the inventory stub; `tick`: the business produces salted meat and smoked meat by the
   `min` rule.
7. Alignment side, as today: `supply(port.bakery, bodies)`, `recruit(esfp-f)`, `develop(port.bakery)`, `sleep`.

**Must hold.**

- After lines 1 to 6: `AlignmentState` is byte-identical to `S0`; `townPosition = P0`; `ending = E0`;
  `slot.owner` of `port.bakery` is `esfp-f`; `slot.developed` is false; the bridge issued no alignment command.
- The ledger holds exactly: one sale, one transfer, one lease, wage rows per tick per filled post, rent rows per
  tick, the project's material and labour draws; account balances sum to the starting total plus nothing.
- `holderOf(title)` is `farm-son`; `operator(biz)` is `esfp-f`; `manager(biz)` is `farm-son`;
  `assignmentsOf('esfp-f')` holds residence and employment; `assignmentsOf('farm-son')` holds residence and
  management.
- `layout.version` of the building is 2 and the `smokehouse` fixture is placed in the new room; reload from JSON
  gives the same.
- Production on line 6 equals `min` of the four caps, with the `smokehouse` raising `Q_equipment` for the smoked
  recipe only.
- After line 7: `slot.developed` of `port.bakery` is true, `slot.pending` true then cleared by `sleep`,
  `slot.pos` equals `esfp-f`'s position, `townPosition` moved accordingly, **exactly as a run without the
  settlement engine**. The settlement state is unchanged by line 7 (recruiting touches no title, lease, post or
  assignment, unless Rex's answer to Q2 says employment ends; then the test asserts that one change and nothing
  else).
- `physical('port.bakery')` reads the building's condition band; `economic('port.bakery')` is `producing`.

## Acceptance (A2, adapter): property transfers reach the story without touching alignment

**(Rex via paste, 2026-10-29.)** Buying the butcher shop may change the butcher's relationship with the player while
the shop's institutional alignment stays unchanged until its own story conditions are met.

Setup as A1. Action: `sell` the butcher shop's building to `player`; `tick`. Must hold: the engine returned a
`titleChanged` event; the adapter's bridge forwarded it to the story's listener as a **relationship** hook
(`{kind: 'titleChanged', place: 'port.bakery', from, to}`; what the hook does to hearts or dialogue is the story
keeper's data, not asserted here beyond "it was called once with these fields"); the bridge issued **no** alignment
command; `AlignmentState` is byte-identical; `slot.owner`, `slot.developed`, `slot.pos` of `port.bakery` unchanged.
Then run A1's line 7 (`supply`, `recruit`, `develop`, `sleep`): the slot develops and transforms exactly as a run
without the sale. Also: a `sell` of a title whose terms forbid transfer to `player` is refused with no event and no
ledger row (Q6).

A second run of the same script with the settlement engine **absent** (the adapter's bridge disabled) produces
the same alignment trace; a run of the package's `examples/` hamlet with the same command kinds and no pirate
data passes U1 to U12. That is the reuse proof.

## Validation (`test/validation.test.ts`; the spec is `VALIDATION.md`)

Stability, conservation and boundary rows (V) and validation against evidence (VAL), one `describe` per row.

| Id | Must hold |
|---|---|
| V1 | the hamlet run for 365 ticks keeps `totalMoney` exactly, after every tick |
| V2 | two runners built the same way give identical business statuses on each of 30 ticks |
| V3 | Q is monotone non-decreasing in fixtures, filled-post hours, materials and the utility cap, and 0 when any is 0 |
| V4 | a recipe with no inputs never yields an infinite or NaN Q; `production[biz]` holds finite numbers only |
| V5 | 30 hamlet ticks conserve hours across lines and projects, never exceeding daily supply |
| V6 | condition stays in [0, 1], falls monotonically over 1,000 ticks without repair, never below 0; a completed repair raises it |
| V7 | a project draws exactly the materials it names, once; a cancelled project draws nothing afterwards |
| V8 | thirty hamlet ticks with one `setWage` on day 10 conserve money; each wage row equals the post's wage at that step |
| VAL-W1 | (todo, waits on Q10) every starting wage within the benchmark band for its trade, ±50 % |
| VAL-D1, VAL-D1a | sourced material lifetimes reach ruin within 1%; unclassified buildings keep their condition for 1,000 ticks and are listed by `unvalidatedDecay`; null classes and exposures are flagged |

VAL-S1, VAL-C1, VAL-W1 and VAL-R1 wait for the starting data (Q10).

## Pirate golden after 2654

- Settlement commit tested: `8dc8fcb` (one status writer, SET-21; includes 2646 decay classes at `79a848a`).
- Pirate golden: `Games/RPG's/pirate-ship/web/src/economy/golden/thirty-days.json` (last re-recorded by pirate 2651, `35c8b3d`, for decay classes and exposure; CHANGES.md lists only that entry). Pirate working tree for `web/src/economy` clean.
- Command (the 2614 golden test, same as the 2615 compare): `npx --prefix <pirate>/web vitest run --root <pirate>/web src/economy/golden.test.ts`. The pirate Vite config resolves the shared settlement engine from `Toolchain/settlement`, so it ran against this HEAD.
- Verdict: **byte-identical.** 1 test passed; the sorted-key JSON of economy, settlement, ledger, log, events and rows matches the golden exactly.
- Differing fields: none. No difference to attribute to 2646 (already in the golden since 2651) or to 2654 (it dropped the spurious second `businessStatusChanged` event; the pirate thirty-day events are unchanged, so nothing moved).

## Pirate golden after 2683

- Settlement commit tested: `d2cc931` (Q20 prepass with in-order production, 2683; includes 2617 partial-hour pool posts).
- Pirate commit: `75ec54f` (pirate 2618's settlement-side work as committed; its `economy.test.ts` type error is not exercised by this filtered run). Golden `web/src/economy/golden/thirty-days.json` unchanged by the run.
- Command: `npx --prefix "E:/AI Programs/Games/RPG's/pirate-ship/web" vitest run --root "E:/AI Programs/Games/RPG's/pirate-ship/web" src/economy/golden.test.ts` (that one test only; the earlier heading did not run the full pirate suite).
- Verdict: **byte-identical.** 1 test passed.
- Differing fields: none. Nothing to attribute to 2617, 2618 or 2683.

## Pirate golden after 2681

- Settlement commit tested: `ae5fcdc` (HEAD; includes 2681 Q20 throw-before-produce, 2683 prepass, 2617 partial-hour pool posts).
- Pirate commit: `6383414`. Golden `web/src/economy/golden/thirty-days.json` not edited.
- Command: `npx --prefix "E:/AI Programs/Games/RPG's/pirate-ship/web" vitest run --root "E:/AI Programs/Games/RPG's/pirate-ship/web" src/economy/golden.test.ts` (that one test only).
- Verdict: **byte-identical.** 1 test passed.
- Differing fields: none. Nothing to attribute to 2617, 2618 or 2681.

## Golden drift

The kernel harness goldens `settlement: A1` and `settlement: hamlet 30 days` drifted after settlement 7e49d3c (unit
3047, IF-27): `hire` now emits `postFilled` on every hire (2 events in A1, 1 in hamlet). With those events removed,
both runs, state and ledger included, were byte-identical to the goldens, so the drift was intended, not a
regression. The two goldens were re-recorded in the kernel repo by unit 5092, with the reason in
`../kernel/harness/golden/SOURCE.md`. Settlement 690b1f7 (kernel v0.1.0 pin) and 4a9d127 (U25, money on kernel
`transfer()`) changed nothing in them.

Rule: every settlement task that changes `src/` or `examples/` runs `npx vitest run golden -t 'settlement: '` in
`../kernel/harness` in its Gate. A golden that differs with no reason in a commit message or this file is a
regression to fix, not a new golden.
