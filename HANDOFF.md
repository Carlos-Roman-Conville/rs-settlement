# Handoff

## State
- Provider-call ports are declared in `kernel.json` (47af0d5, SET-32); the construction take ports map to `units_taken` and `stock_changes` (6372c73).
- Office powers route through an optional authority provider (e52afbd, U22). Land subjects are passed to the authority checks (6e350e3, U23). Contract: GOVERNMENT-SETTLEMENT.md, agreed by both keepers (ac0a81d).
- Hire completion reports its intention cause and outcome (7e49d3c, U24). The engine emits the event `postFilled`.
- CONTRACTS.md has sections 17 (provider queries are pure), 18 (what hours returns; named wage holders) and 19 (a person's reservation wage, IF-27), each copied byte-identically from the economy keeper.
- Kernel: settlement depends on `@rex/kernel` at tag v0.1.0, fetched from the backup mirror (690b1f7, unit 5064), not a folder link.
- U25: `pay()` moves money through the kernel `transfer()` via `moneyLedger` in `src/money-ledger.ts` (4a9d127). Credit/debit and zero-amount deeds are not transfers. Whether a payer may go into debt is open (Rex's Q19).
- Golden drift: the two settlement goldens were re-recorded for `postFilled` (kernel d62287a, unit 5092); see TESTS.md `Golden drift` (8687fa4). Last pirate golden compare: byte-identical after 2681; the pirate-ship settlement and economy tests run in the Gate of 5093 (d57d0a3). Every task touching `src/` or `examples/` runs the settlement goldens in its Gate.

## Next
- Pay-for-goods batch: design in TRANSFER-BATCH-DESIGN.md (recommends a goods leg on `pay`, Option B). Next: send its questions to the economy keeper, then agree a new CONTRACTS section before any build. Q19 stays open.

## Blocked
- The host must map the engine event name `postFilled` to registry row `settlement.post_filled`; the outcome registry producer is `shared.action.resolution`, not settlement.

## Gotchas
- The golden compare is the filtered `src/economy/golden.test.ts` only; the pirate Vite config resolves the engine from Toolchain/settlement.
- CONTRACTS.md changes only as a new section both keepers agree, copied byte-identically; never edit earlier text (82d6e2a reverted such an edit).
- Production provider queries must be pure (CONTRACTS s17); wages are written only through `setWage` (U17).
- Codex/Composer commits here carry their own co-author lines; add the session's line on yours.
