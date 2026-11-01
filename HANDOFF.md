# Handoff

## State
- Provider-call ports are declared in `kernel.json` (47af0d5, SET-32); the construction take ports map to `units_taken` and `stock_changes` (6372c73).
- Office powers route through an optional authority provider (e52afbd, U22). Land subjects are passed to the authority checks (6e350e3, U23). Contract: GOVERNMENT-SETTLEMENT.md, agreed by both keepers (ac0a81d).
- Hire completion reports its intention cause and outcome (7e49d3c, U24). The engine emits the event `postFilled`.
- CONTRACTS.md has sections 17 (provider queries are pure), 18 (what hours returns; named wage holders) and 19 (a person's reservation wage, IF-27), each copied byte-identically from the economy keeper.
- Pirate golden compare: last recorded byte-identical after 2681 (settlement `ae5fcdc`, pirate `6383414`), in TESTS.md "Pirate golden after 2681". It has not been rerun since the authority and hire changes (src and kernel.json changed after that).

## Next
- Nothing queued; the next unit needs a keeper-agreed interface (IF-number) or a DEPENDENCIES.md/CHAINS.md entry.

## Blocked
- Pirate task 2618 sat in pirate-ship's failed/ with an `economy.test.ts` type error (last noted in TESTS.md); not rechecked here, not touched.
- The host must map the engine event name `postFilled` to registry row `settlement.post_filled`; the outcome registry producer is `shared.action.resolution`, not settlement.

## Gotchas
- The golden compare is the filtered `src/economy/golden.test.ts` only; the pirate Vite config resolves the engine from Toolchain/settlement.
- CONTRACTS.md changes only as a new section both keepers agree, copied byte-identically; never edit earlier text (82d6e2a reverted such an edit).
- Production provider queries must be pure (CONTRACTS s17); wages are written only through `setWage` (U17).
- Codex/Composer commits here carry their own co-author lines; add the session's line on yours.
