# Government ↔ Settlement contract (AGREED 2026-10-31, both keepers)

**Status: AGREED 2026-10-31 (both keepers).** The Settlement keeper's amendment is marked inline as
(settlement: ...), confirmed by the Government keeper with no changes the same day. Drafted by the Government keeper from the boundary both keepers agreed on 2026-10-31
(Government DESIGN §2.3, points 1–7, checked by the Settlement keeper) and the DUP-62 acceptance test both keepers
agreed and sent to the registry keeper (owner split approved by Rex in overlap batch 2b, 2026-10-31). When agreed,
this file and `Toolchain/settlement/GOVERNMENT-SETTLEMENT.md` hold the same text, byte for byte. Rules as for the
Settlement ↔ Economy contract: sections are append-only; a change is a new section agreed by both keepers before
code; no belt unit edits this file. Marks: **(Rex)** a decision this contract only restates; **(proposed)** either
keeper's proposal, open to the other; **(open)** a question for Rex.

## 1. One sentence per side

- **Settlement** keeps the records: offices `{id, name, holder, seat}`, who holds each (written only by `appoint`,
  `vacate` and `inherit`) (settlement: an office's holder is written only by `appoint` and `vacate`; `inherit`
  writes a title's holder, with the other title commands), permissions and their expiry, titles, leases, the ledger, accounts and `pay`.
- **Government** decides what an office may do and how authority passes (delegation, succession), from its law
  records; its decisions reach Settlement only as commands and port answers (Rex, batch 2b, DUP-62).

## 2. The power check is a port

Settlement's `officeHas(ctx, office, power)` (`src/context.ts:78`) becomes a call to the provider port

```ts
interface AuthorityProvider {
  /** Pure (Settlement CONTRACTS §17): may this office exercise this power over this subject on this day? */
  may(office: string, power: string, subject: string | null, day: number): boolean
}
```

declared by Settlement as an `in` port under the provider-ports rule (Kernel DESIGN §8.1). Every power check in
Settlement goes through it: `public-title` (`commands.ts:178`), `seize` (`:212`), `permit` (`:624`, `:637`).
Settlement keeps no other power check. Settlement keeps the null-office check, the vacancy check (no holder →
refuse) and today's error texts; a `false` answer raises today's "lacks the power" error.

**Default provider (no Government present):** reads `Office.powers[]`, exactly today's rule. It is host setup data
serving the port, not a Settlement decision. **Government's provider:** answers from its `empower` laws in force
and their jurisdiction (Government DESIGN §1.1, §1.2, §1.6).

## 3. Succession and inheritance

Settlement has no succession or inheritance law: `inherit(title, heir)` and `appoint(office, holder)` take the person
their caller names. With Government present, Government is that caller: it emits `government.succession_event`
and issues the command. Settlement records; Government never keeps a holder field. **(Rex)** Which inheritance law
applies to any particular world (the pirate town among them, SET-11) is Rex's decision, not either keeper's.

## 4. Permits

`startProject.permitRequired` stays a field the caller supplies. With Government present, the host fills it from
Government's `require` laws. No second provider call inside Settlement's commands; the default is unchanged.

## 5. Tax and public money (DUP-42)

Tax runs in **Government's own process phase**, never inside Settlement's tick. Government computes each assessment
and moves money only through Settlement's `LedgerProvider` (`pay` / transfer), as Economy does (Settlement CONTRACTS
§3), so the ledger stays money's one home. The treasury is a Settlement account. Settlement's `publicWorks()` step
(`src/tick/wages.ts:22`) stays a no-op; its tax comment is retired when Government's tax unit lands. Fines and
seizures ordered by Government are likewise `pay` and `transfer` (kind `seizure`) commands.

## 6. Offices created by law

`createOffice.powers` stays valid setup data. With Government present, an office is created by a Government
`establish` law that issues `createOffice`, and its `powers` are a read of Government's grants, never a second
authority.

## 7. Acceptance test (DUP-62; agreed by both keepers 2026-10-31, sent to the registry keeper)

1. Every office power check (permit at `commands.ts:624`/`:637`, public-title `:178`, seize `:212`) goes through
   `AuthorityProvider.may`, so an act of authority, including issuing a permit, happens only when Government's rules
   allow that office to do it. Settlement keeps no other power check.
2. A succession changes the office holder only through a Settlement `appoint` / `vacate` / `inherit` command issued
   by Government.
3. No Settlement mechanism decides what an office may do. The `Office.powers[]` default provider is host setup data
   serving the port.
4. With Government absent, the default provider gives byte-identical thirty-day outputs, and the settlement suite
   (U10 included) passes unchanged.

## 8. Changes this contract asks (each a belt unit after agreement)

- **Settlement:** declare the `AuthorityProvider` in-port and route `officeHas` through it with the default provider
  (Settlement's unit; Gate: the settlement suite and the thirty-day byte-identity check).
- **Government:** serve `AuthorityProvider.may` from `empower` laws (Government's unit, after the law evaluator);
  a combined test with Settlement's real commands for tests 1–3.

## Tagged `may` and funding holds (AGREED 2026-11-02, Government and Settlement keepers; Rex's condition of the same day)

Staged in HQ; it is landed as a new section of GOVERNMENT-SETTLEMENT.md in both repos by a composer copy unit after the
build stop lifts. Nothing earlier in the file is edited.

1. **Tagged `may`.** `AuthorityProvider.may(office, power, subject, day)` returns `{ kind: 'yes' } | { kind: 'no', reason }
   | { kind: 'unknown', reads: string[] }`; no bare object a truthy check could pass. The default `officePowersAuthority`
   returns `{ kind: 'yes' }` or `{ kind: 'no', reason: 'lacks power' }`, with today's denial text unchanged. The query stays
   pure (Settlement CONTRACTS §17).
2. **Unknown is refused, never permitted, never a denial (Rex).** `officeHas` (`settlement/src/context.ts:153`, five call
   sites) throws `authority unresolved: <reads joined by ', '>`, a text distinct from the denial texts. The command does
   nothing, writes no row, and is not recorded as a denial. The host retries once the read resolves. Settlement keeps no
   pending-command queue.
3. With Government absent the thirty-day run is byte-identical (GOV-8 item 4).
4. Physical acts outside Settlement's command boundary never call `may` (GOV-25, Rex). `holder` changes only through an
   accepted `appoint`.
5. **Funding holds (GOV-31), owned by Settlement.**
   a) `hold(account, amount, ref, currency = 'money')` creates one record in a new `holds` state per ref; a duplicate ref
      throws. Per currency, available = balance − Σ active holds. A hold with amount > available is refused, so two
      decisions cannot promise the same funds.
   b) `release(ref)` ends the hold and moves no money. `settle(ref, payee, amount?)` is one kernel `transfer()` from the
      held account to the payee; the amount defaults to the whole hold. A partial settle keeps the remainder held until
      it is released, and an amount above the hold throws.
   c) Holds are encumbrances, not ledger money rows. A settle writes one ordinary payment row carrying the ref. Holds
      replay deterministically. A hold made in a tick or transaction that rolls back is undone.
   d) Unheld payments keep today's behaviour (no balance refusal), so an unheld `pay` can drive available below zero.
      This is recorded as visible, and no rule is added. Whether unheld spending may touch held funds is Rex's question
      (Settlement Q19), still open.
   e) Economy's LedgerProvider gains `available` and the hold verbs in a separate CONTRACTS section with the Economy
      keeper, not this one.
   The shape matches Economy's reserve/release/fulfil material holds (ST-6) and the kernel's time ledger.

## Log

| Date | What |
|---|---|
| 2026-10-31 | Proposed by the Government keeper from the agreed DESIGN §2.3 and DUP-62 acceptance test |
| 2026-10-31 | Agreed by the Settlement keeper with one amendment (§1: `inherit` writes title holders, not office holders) |
| 2026-10-31 | Confirmed by the Government keeper; AGREED (both keepers) |
