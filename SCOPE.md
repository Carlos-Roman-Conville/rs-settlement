# settlement

## What this is

The settlement engine: a reusable backend for simulated towns (land, property, buildings, businesses, workforce,
production, authority). Design only as of 2026-10-29; the pirate game's town is its first client.

## What's under it

| Folder | What | State |
|---|---|---|
| [src/](src/), [test/](test/), [examples/](examples/) | The engine (step 1 built 2026-10-29: records, ledger, assignments, projects, businesses, tick), its tests and the hamlet. | active |
| (design docs) | README, dependency map, package boundaries, migration plan, test specs, Rex's questions. | active |

## Read first

- [README.md](README.md): what it is and the reading order.
- [QUESTIONS.md](QUESTIONS.md): what is waiting on Rex before any code.

## Skim

- [PACKAGES.md](PACKAGES.md) when wiring a game to it; [MIGRATION.md](MIGRATION.md) for the pirate town.

## Ignore

- `node_modules/`.

## Rules that apply here

Inherited from [HQ/PRINCIPLES.md](../../HQ/PRINCIPLES.md) and [Toolchain/SCOPE.md](../SCOPE.md), plus:

- The engine imports nothing from any game or other engine; cross-engine needs are provider interfaces.
- No game rule is invented here: every number is proposed until Rex sets it; `port.*` and `sec.*` ids are the
  pirate game's and never appear in engine state.
- Design docs change only with Rex's decisions recorded by mark; code starts only after he approves `MIGRATION.md`.

## Current state

- 2026-10-29: folder created with the design set; Rex approved the architecture and step 1 (agreeing with
  ChatGPT's review) and answered Q2; Q1 and Q6 answered in part. Step 1 built: `npm test` 23 green, typecheck
  clean. Step 2 (the pirate adapter, T0 guard, A1, A2) built the same evening on Rex's verbatim approval. Next:
  step 3 (the derived map) once Rex gives the footprint classes (Q1); step 4 sign-off once he confirms the
  starting title rows (Q6).
- 2026-10-30: Rex reorganised the keepers; this one owns the engine, makes no pirate narrative or government
  decisions, and implements no production or labour calculation beyond today's until the Economy contract is
  agreed. The economy keeper's proposal was answered the same day in `CONTRACTS.md` (counter-proposal: rates via
  the provider, `TransactionKind` to string, a `pay` command, `setWage`); the economy keeper confirmed all nine
  amendments the same day and the code landed (26 tests green; the pirate adapter re-run green). Next concrete
  task: none until Rex answers Q1, Q5, Q6, Q7, Q10 or the economy keeper's engine reaches the adapter.
- 2026-10-30, later: Rex added cemeteries (parcels with grave capacity and burial infrastructure), sanitation
  infrastructure and land use to this engine's scope: recorded in `PACKAGES.md` s8, not designed, not built. The
  starting-town rows (Q1, Q5, Q6, Q7, Q9, Q10, Q11, Q15) are being researched historically for
  `files/pirate-ship/STARTING_TOWN.md` (Rex: historical data fills answers first).
- 2026-10-30, evening: DUP-44 fixed (`Project.inventory` apart from `Project.account`; U16; 27 tests) so the
  kernel's byte-identity baseline is taken after it. The kernel keeper's P0 adoption (ids, Runner.replay, clock,
  transactions) is answered in their DESIGN.md s12 and waits on Rex.
