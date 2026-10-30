# @rex/settlement: the settlement engine (design only, 2026-10-29)

A reusable backend for a simulated settlement: land and parcels, buildings with persistent layouts, property
titles, leases and a ledger, construction and renovation, businesses, workforce and wages, production as a
constraint, public works, offices and permissions. A game supplies its history, locales, people, factions and
story through an adapter; the engine never imports a game. Modelled on `../realism` (Rex: a reusable backend
like Toolchain/realism, not an extension of the pirate town's slot system).

**Status: architecture approved and step 1 built (Rex, 2026-10-29, agreeing with ChatGPT's review). Nothing in
any game changed.** Steps 2 onward wait on the answers `MIGRATION.md` names per step.

## Run

    npm install --offline      # vitest and typescript from the cache (the realism lock file)
    npm test                   # U1 to U12 and the hamlet example
    npm run typecheck

## Built so far (step 1, 2026-10-29)

Labour uses the shared `LabourSupply` contract and person-hours, with finite daily pool grants (U18, V5).
Production and project wages preserve the converted fixture results; `labourSharing` defaults to `in-order` (U19).
`setInventory` rebinds a business to the host's inventory ref before its next tick (U20).
`setWage` is the only channel for a wage level; U17 pins it and Q19 (wage debt) is open.
The hamlet's buildings carry decay classes (the house `reed-thatch`, the shop `wood-shingle`), so the example exercises decay.

`src/`: the records (`state.ts`), ids (`ids.ts`), tunables with placeholder bands (`config.ts`, every number
proposed), the four provider interfaces with in-memory stubs (`providers.ts`), the command union and handlers
(`commands.ts`: land, property with `transferable` terms, leases, the ledger, projects, layouts, businesses, posts,
assignments, offices, permissions, money), the seven tick steps (`tick/`), the reducer and a `Runner`
(`reduce.ts`), queries (`queries.ts`). `examples/hamlet.ts`: three parcels, two construct projects, a sawyer's line,
no game data. `test/engine.test.ts`: one describe per TESTS.md U-row, 16 tests.

Step 2 (the same evening, on Rex's verbatim approval via the town keeper): the pirate adapter in
`Games/RPG's/pirate-ship/web/src/settlement/` (`load.ts`, `bridge.ts`, `index.ts`, `settlement.test.ts`) over
`data/pirate-ship/settlement/start.json`; T0, T1, A1 and A2 green beside the game's 274 other tests. The engine
gained `addBuilding` (seed a standing building) and `test/acceptance.test.ts` (the engine half of A1).

2026-10-30, the Economy contract (`CONTRACTS.md`, agreed): a production line is `{ recipe, equipment }` and its
rates come from `MaterialProvider.rates(recipe)` each tick; `TransactionKind` is any string (`SETTLEMENT_KINDS`
lists the engine's own); the `pay` command and the `ledger` query's holder and day range are the economy's
`LedgerProvider` over this engine's accounts; `setWage` sets a post's wage. U13, U14; 26 tests.
`Project.inventory` (DUP-44, the economy keeper's finding): a project draws its materials from its own inventory
ref, no longer from its payer's holder id; `startProject` takes `inventory` (default: the account, for old
callers). U16; 27 tests.

What the code encodes of Rex's answers: a sale changes the holder and nothing else (U3); a title can refuse a
buyer (U3, Q6); assignments never end on their own (U4); a business runs while its operator is away if a manager
is available (U7, Q2); layouts change only through projects unless `config.freeLayout` is set (U8, Q8 default);
the heir of an `inherit` is named by the host (no law of succession); offices grant permits only with the power
(U10). The engine still names nobody (U12).

## Read in this order

1. [DEPENDENCIES.md](DEPENDENCIES.md): what the pirate game's town, alignment, economy and map code and data are
   today, how they depend on each other, and the fixed points the engine must not move.
2. [PACKAGES.md](PACKAGES.md): the four packages (settlement, realism, economy, the pirate adapter), the
   records, commands, tick, queries, events, the provider interfaces and the id scheme.
3. [MIGRATION.md](MIGRATION.md): twelve steps that keep the slot model and `port.align` working at every step,
   with the map-derivation worked example.
4. [TESTS.md](TESTS.md): package and adapter test specs, ending in the acceptance test A1.
5. [QUESTIONS.md](QUESTIONS.md): what only Rex can answer, and what is assumed meanwhile.
6. [CONTRACTS.md](CONTRACTS.md): the Settlement-Economy contract (ledger, materials, rates, the reader, the day
   order), agreed with the economy keeper 2026-10-30; both repos hold the same text.
7. [VALIDATION.md](VALIDATION.md): per mechanism, the model and its evidence level, the tests that verify it,
   the evidence it is validated against and the report (Rex's V&V directive, PLATFORM.md §11a).

## Marks

**(Rex)** his decision; **(Rex, via paste)** a ChatGPT resolution he pasted without comment on 2026-10-29, held
as his until he corrects it; **(proposed)** this keeper's or ChatGPT's starting point; **(open)** nothing decided.
Every number in these files is proposed.

## The decisions these files honour (Rex, 2026-10-29)

Ownership is not control: property ownership, business operation and management are separate; one legal owner,
many tenants. Physical development and economic activity are tracked independently. Residence, employment,
management and crew membership are separate, non-exclusive assignments. The mayor is an office inside the
existing town hall; the `sec.townhall` contest stays. One continuous, expandable town map with districts and
subdividable parcels; no fixed counts; dimensions derived from the existing locales, housing, roads, harbour and
undeveloped land. A brewery is an optional constructible facility. An institution's alignment never changes
because its owner or manager changes; the story-driven transformation system stays. `port.*` and `sec.*` remain
story and institution references; parcels, buildings, businesses and titles get their own ids. Property and
economy stay independent of the ghost and death question.

## Shape

    package.json        @rex/settlement, TypeScript, vitest, no dependencies (as realism)
    src/ids.ts          prefixes, counters, retirement
    src/state.ts        the records, JSON-safe, versioned
    src/config.ts       condition bands, freeLayout, hoursPerDay, the tick order (placeholders, proposed)
    src/commands.ts     the command union and every handler
    src/context.ts      the reduce context: copy, mint, accounts, pay, right of use, office powers
    src/reduce.ts       reduce(state, command, config, providers) -> { state, events }; Runner
    src/tick/           decay, projects, staffing, production, wages (+ publicWorks), expiry
    src/queries.ts      holderOf, assignmentsOf, hasFixture, physical, economic, production, ledger, mapLayer
    src/providers.ts    LabourProvider, MaterialProvider, UtilityProvider, PriceProvider + stubs
    src/events.ts       the events reduce returns
    examples/hamlet.ts  a hamlet with no game data: the reuse proof
    test/               one describe per TESTS.md U-row
    (later) scripts/derive_map.py   requirements -> dimensions, districts, first parcels (step 3, no typed counts)

Decay now uses the interim material classes (R-2, VALIDATION section 4b); intentionally, unclassified buildings no longer decay and are listed by `unvalidatedDecay`.
