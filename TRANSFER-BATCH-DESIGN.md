# Transfer batch: paying for goods in one kernel `transfer()` (design note, settlement keeper, 2026-11-01)

Design only; nothing here is built. The aim: a pay-for-goods exchange in which the money leg (settlement's
`moneyLedger`, `src/money-ledger.ts`, U25) and the goods leg (economy's goods ledger, economy 5068) both commit or
neither does. Settlement has not read economy's ledger; every assumption about it is marked and listed as a question
at the end. **Q19 (may a payer go into debt) stays open throughout**: no option below decides it.

What settlement has today (from U25, 4a9d127):

- `moneyLedger(ctx)` is a kernel `TransferLedger` with id `settlement.money`, holders = account holders (`biz.*`,
  persons, pools, the treasury), one quantity `money`. `unit` and `apply` throw on an unknown holder or quantity;
  `snapshot` / `restore` clone `state.accounts` only.
- `pay()` moves money through the kernel `transfer()`; a failed batch restores accounts (U25). The `txn` row
  (`id`, `day`, `kind`, ...) is Settlement's, not the ledger's, so it is not covered by `snapshot` / `restore`.
- Balances may go negative (debt), as CONTRACTS §3 and §16 say and Q19 leaves open. The money ledger never
  refuses on balance today.
- Credit/debit and zero-amount deeds are not transfers and stay outside any batch.

Two constraints every option must meet:

1. **Replay.** Settlement's reducer is pure over its command log (CONTRACTS §9). A money move made outside a
   settlement command would not replay; so the money leg must happen inside a settlement command.
2. **One row per committed move.** The `txn` row is written only after the batch commits, in the same command, so
   a rolled-back batch leaves no row and no event.

## Options

### A. The host builds the batch

The pirate adapter (host) calls the kernel `transfer()` itself with two legs, one on `moneyLedger(ctx)` and one on
economy's goods ledger, then tells settlement to write the row.

- Where the batch is built: in the adapter, outside both reducers.
- Who owns atomicity: the kernel (snapshot/restore of both ledgers), driven by the host.
- Debt refusal: none today; if Q19 is ever answered "no debt", the refusal would be a throw in the money leg, and
  the kernel would restore both ledgers.
- Against: the money leg mutates `state.accounts` outside a settlement command, so the command log no longer
  replays (constraint 1), and settlement would need a second "write the row" command whose consistency with the
  balance move nobody checks. The adapter would also need a live `Ctx`, which no engine exposes today.

### B. Settlement builds the batch inside `pay` (a goods leg on the `pay` command)

The `pay` command gains an optional goods leg, e.g. `goods?: { from, to, good, units }` (inventory refs and a good
id, opaque to settlement). The `pay` handler builds one kernel `transfer()` with the money leg on
`moneyLedger(ctx)` and the goods leg on a goods `TransferLedger` the host passes in the providers (a new optional
provider, e.g. `providers.goods`). `LedgerProvider.transfer` (CONTRACTS §3) gains the same optional argument, so
the economy's sale or purchase is one call through the host, which issues one `pay`.

- Where the batch is built: in settlement's `pay` handler, the one place money already enters the kernel.
- Who owns atomicity: the kernel `transfer()` (both ledgers' `snapshot` / `restore`); settlement writes the `txn`
  row and event only after it returns.
- Debt refusal: none today (Q19 open). Refusals that exist today roll both legs back: an unknown holder or quantity
  in the money ledger, and whatever the goods ledger refuses (assumed: stock below the units, since economy promises
  stock never goes negative, §11). A later Q19 answer would add one refusal in the money leg; the batch shape does
  not change.
- Precedent: settlement already writes economy state inside its own reducer through `MaterialProvider.produce`
  and `take` (§9: economy's inventories accept writes during settlement's tick).
- Cost: a new CONTRACTS section (provider shape change, §11), agreed by both keepers before code.

### C. Economy builds the batch

Economy's market clearing builds the kernel `transfer()` with its goods leg and settlement's money leg, which the
host would expose through a new `LedgerProvider.ledger(): TransferLedger`.

- Where the batch is built: in economy's tick.
- Who owns atomicity: the kernel, driven by economy.
- Debt refusal: as in A.
- Against: the same replay break as A, now inside economy's reducer: settlement's balances change with no
  settlement command, and economy would also have to write settlement's `txn` row, which §3 gives to settlement.

## Recommendation

**Option B.** It is the only option that keeps settlement's money moves inside a settlement command (replay), keeps
the `txn` row with its balance change, and adds no new owner: the kernel owns atomicity, settlement owns the money
leg and the row, economy owns the goods ledger and what it refuses. Q19 stays open; the batch never refuses on
balance until Rex answers.

What a later build would touch (after the economy keeper answers below and a new CONTRACTS section is agreed):

- `CONTRACTS.md`: a new section (the goods leg on `pay` and on `LedgerProvider.transfer`, the optional goods
  ledger provider), copied byte-identically from the agreed text; no earlier section edited.
- `src/providers.ts`: the optional goods `TransferLedger` provider.
- The `pay` command type and its handler (where 4a9d127 put the kernel `transfer()` call): the optional goods leg,
  one batch, row and event after commit; `pay` without `goods` byte-identical to today.
- `src/money-ledger.ts`: expected unchanged.
- `test/money-ledger.test.ts` (U25) stays; a new `test/transfer-batch.test.ts` (U26 in `TESTS.md`), with a stub
  goods ledger: both legs commit; a goods refusal rolls back money and goods with no row and no event; an unknown
  money holder rolls back the goods leg; a payer may still go negative (Q19 open); money and goods conserved;
  replay of the log gives the same state.
- Gate: the settlement goldens (`npx vitest run golden -t 'settlement: '` in `../kernel/harness`) must not move,
  since no existing command changes behaviour.

## Questions for the economy keeper

1. Does the goods ledger from 5068 implement the kernel `TransferLedger` at v0.1.0, and what are its `id`, its
   holders (inventory refs?) and its quantities (good ids?)? What does its `unit` return?
2. What does it refuse, and how: a throw from `apply` when stock would go negative, a check before, or something
   else? Any refusal besides stock?
3. What do its `snapshot` / `restore` cover (all inventories, or only those touched), and do they include the
   market's recorded figures, so a rolled-back sale leaves the market unchanged?
4. Where does a sale or purchase record its market effect (volume, observed consumption): inside the ledger's
   `apply`, or after the transfer returns? Inside `apply` would be rolled back only if `snapshot` covers it.
5. Does the economy today move money (through `LedgerProvider.transfer`) and goods in two steps, and in which
   order? What does it do now if the second step fails?
6. Would the economy issue the paired move through an optional goods argument on `LedgerProvider.transfer` (Option
   B), or does it prefer to keep the legs separate? Either needs a new CONTRACTS section.
7. One row or two: is one settlement `txn` row (`sale` or `purchase`, subject the good or the order) enough for
   economy's accounting (§8), or does economy want its own goods-side record of the same exchange?
8. Are goods units integers, or may a leg move a fraction (casks, weights)?
9. Is a goods move ever free (gift, spoilage, seizure)? Settlement would keep those out of `pay`, as it keeps
   credit/debit and deeds out of the money ledger.

Open for Rex, not decided here: **Q19**, whether a payer may go into debt or an unpaid payment stalls. Until then the
batch never refuses on balance.
