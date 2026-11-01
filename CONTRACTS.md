# Settlement ↔ Economy contract (AGREED 2026-10-30, both keepers)

**Status: AGREED 2026-10-30.** The economy keeper's proposal (`Toolchain/economy/CONTRACTS.md`, commit 028c70e)
with the settlement keeper's amendments marked inline as (settlement: ...), confirmed by the economy keeper with
no changes the same day; the section 13 code landed in Settlement the same day. This file and
`Toolchain/economy/CONTRACTS.md` hold the same text from the §1 heading down; ENGINES.md records the date. Any
change is a new section agreed by both keepers before code.
Marks: **(Rex)** a decision of Rex's that this contract only restates; **(proposed)** either keeper's proposal,
open to the other; **(open)** a question neither keeper may answer: it goes to Rex. Nothing here is a game rule.

What this contract is for (ENGINES.md): wages, staffing, business inventory, production capacity. It also settles
transactions and accounting, because the two engines meet in the same ledger. The principle throughout is the one
realism and settlement already follow: **every number has one home**, each engine reaches another's numbers
through a provider interface the host implements, and **no engine imports another engine**.

## 1. One sentence per side

- **Settlement** owns *where* economic activity happens and *who* is in it: premises, fixtures, businesses as
  legal and physical things, posts, holders, assignments, projects, titles, leases, offices. Its tick decides each
  day **how much a business can make** (the capacity Q) and **what it pays its people** (wages, rents).
- **Economy** owns *what* is made, held, wanted and traded, and *what it is worth*: the goods catalogue, recipes
  (inputs, outputs, equipment, band, knowledge), every inventory's stock, each market's five numbers (stock,
  consumption per day, target reserve, production per day, base price: Rex, ALIGNMENT §10), prices, consumption,
  the labour market's wage quotes, trade and transport, organisations (companies), and the accounting view of a
  business (revenue, costs, profit, valuation).

(settlement: agreed as written.)

## 2. Who owns which record

| Record | Owner | The other side sees it as | Notes |
|---|---|---|---|
| `Business`, `Post`, `Assignment`, `Project`, `Title`, `Lease`, `Office`, `Permission`, `Building.fixtures` | Settlement | read-only through `SettlementReader` (§4b) | unchanged from today's `state.ts` |
| `Business.inventory` (the opaque ref) | Settlement stores the string; **Economy mints and owns what it refers to** | Economy: an `Inventory` record keyed by that string | the host asks Economy for an inventory id (`openInventory`) before `openBusiness`, and passes it in. (settlement: agreed; the pirate adapter's `inv.port.*` strings in `load.ts` are placeholders until Economy exists, then the adapter asks `openInventory` and the `inv.` prefix is Economy's alone, §10) |
| `Business.lines[]` | Settlement stores `recipe` and `equipment`; **the two rates come from Economy** | Economy: `Recipe.rates` | (settlement: **accepted, the provider**: `ProductionLine` becomes `{ recipe, equipment }`; the tick reads `rates(recipe)` from the material provider at production time, so a recipe's rate has one home. `equipment` stays on the line because fixtures are Settlement's and are counted from buildings; the host sets it from Economy's recipe data at `openBusiness` / `setLines`) |
| `Recipe` (id, skill, band, min level, inputs, inputsAny, equipment, knowledge, region, by-products, and the per-unit quantities, labour and equipment rates) | Economy | Settlement: an opaque recipe id | recipe quantities, yields and labour per unit are **data the host supplies** (not in the pirate data yet: `data/pirate-ship/economy/README.md` "Not here yet") |
| `Good` (id, type base/specialty/cultural/money, weight, spoilage, legality) | Economy | never | types are **(open, Rex: GOODS.md Open 1–8)**; the engine takes them as data |
| `Inventory` (holder, market, stock per good) | Economy | Settlement: the ref only | one per business; per household, pool, ship or warehouse if the host wants; the holder string is the same opaque holder Settlement uses. (settlement: a project's materials are also drawn from an inventory ref, `Project.account`, through `have` / `take`; same rule) |
| `Market` (one per settlement or port: the five numbers per good, current price, shortage) | Economy | never | a Settlement-run town and an abstract port are both markets |
| `Shipment`, `Route`, `Order`, `Organisation` | Economy | never | travel days come from the host's map (a `TransportProvider`), never from Economy |
| `Account`, the `ledger` | **one home, chosen by the host** | both engines through their own interface | see §3 |
| `production[biz][day]` (Q per line, the binding cap) | Settlement | Economy reads it to record each market's observed production per day | Economy never recomputes Q for a Settlement-run business |
| `Post.wage` | Settlement (host data per post) | Economy quotes a market wage; it never writes a post | see §5 |

## 3. Money (proposed)

Money has one home. Today that home is Settlement's `accounts` and `ledger` (`pay`, `record`), and nothing in this
contract moves it. Economy declares a `LedgerProvider` and never keeps balances of its own:

```ts
interface LedgerProvider {
  balance(holder: string): number
  /** Move money and write one ledger row; returns the row id. Balances may go negative (debt) as in Settlement. */
  transfer(from: string, to: string, amount: number, kind: string, subject: string | null, note?: string): string
  /** Rows touching a holder in a day range, for accounting. */
  rows(holder: string, fromDay: number, toDay: number): LedgerRow[]
}
```

In the pirate game the host implements it over Settlement's accounts (through Settlement commands or a shared
account store: the adapter's choice). In Economy's own tests it is an in-memory stub. Economy's row kinds
(`sale`, `purchase`, `freight`, `duty`, `dividend`) are strings; **(settlement: `TransactionKind` becomes
`string`; Settlement's own kinds stay listed as the exported constant `SETTLEMENT_KINDS` for documentation and
tests; Economy's kinds are Economy's to name, and `sale` and `purchase` are already shared spellings)**.
**(open, Rex: Settlement Q7)** whether `port.cash` is the treasury.

(settlement: how the host implements the provider over Settlement, so the adapter has one way, not a choice:
`balance(holder)` = the query `balanceOf(state, holder)`; `transfer(...)` = the new command
`{ type: 'pay', from, to, amount, kind, subject?, note? }`, which returns the row id and stamps the settlement's
day; `rows(holder, fromDay, toDay)` = the query `ledger(state, filter)` with a `day` range added to its filter.
The row type is Settlement's `Transaction`; Economy's `LedgerRow` is that shape: `{ id, day, kind, from, to,
subject, amount, authority, note }`.)

## 4. The interfaces

### 4a. What Economy implements for Settlement (Settlement's `providers.ts`)

| Settlement asks | Economy answers | Promise |
|---|---|---|
| `MaterialProvider.available(inventory, recipe)` | output units the inputs on hand allow, by Economy's recipe quantities; `Infinity` for a recipe with no inputs | pure; the same answer twice in a day. (settlement: the tick floors it; a fractional answer is allowed) |
| `MaterialProvider.produce(inventory, recipe, units)` | consumes inputs (an `inputsAny` choice: the host's rule, default the first available: **(proposed)**), adds outputs and by-products, records the day's production on the inventory's market | throws if `units > available` (settlement: guaranteed never asked; `units` is a non-negative integer, at most `floor(available)`, and never 0: the tick skips a line with `q = 0`) |
| `MaterialProvider.have(inventory, material)` / `take(inventory, material, units)` | stock reads and draws for projects | `take` returns what was taken, at most `units`, at most the stock; the project step takes a project's materials all or nothing, checking `have` for each first |
| `MaterialProvider.rates(recipe)` → `{ unitsPerFixtureDay, labourPerUnit }` | the recipe's rates | (settlement: **accepted**; read once per line per tick; must be finite and non-negative; `labourPerUnit = 0` means the line needs no labour) |
| `PriceProvider.valueOf(subject, day)` | **goods and inventories only**: a good's current market price, an inventory's value at market | **(open, Rex)** who values a title, building or parcel for a sale the host does not price: Economy can offer a materials-plus-labour replacement cost; a land market is not proposed. (settlement: today no engine code calls `valueOf`; `sell` takes an explicit `price`. The provider stays declared for the open item; the engine will call it only once Rex answers, and then only for a `sell` without a price) |

Economy does **not** implement `LabourProvider` (available, draw, productivity: persons, skill bands and pools are
the host's and realism's POPULATION work; Economy offers only a band-to-factor table as data if asked) or
`UtilityProvider` (realism). (settlement: agreed. For the record, Settlement's `LabourProvider` today is
`available(person, day)`, `draw(pool, role, requires, wanted, day) → number`, `productivity(holder, role)`;
`UtilityProvider` is `capacity(building, recipe, state)`. Neither is part of this contract.)

### 4b. What Settlement gives Economy (`SettlementReader`, read-only, pure over `SettlementState`)

Economy never holds a `SettlementState`; the host passes a reader each tick:

```ts
interface SettlementReader {
  businesses(market: string): { id: string; inventory: string; account: string; status: string; open: boolean }[]
  posts(market: string): { id: string; biz: string; role: string; wage: number; hours: number; filledBy: string | null }[]
  production(biz: string, day: number): { recipe: string; q: number }[] | null
  hasFixture(market: string, fixture: string): boolean          // "a settlement has or lacks each" (GOODS.md 3h)
}
```

(settlement: **confirmed derivable today**, one market per `SettlementState`, the market id being
`state.settlement.id`: `businesses` = `Object.values(state.businesses)` projected; `posts` = `Object.values(state.posts)`
projected (`filledBy` is today's resolution, null when the holder was unavailable); `production(biz, day)` =
the query `production(state, biz)`, which holds only the latest day: the reader returns its `lines` when
`record.day === day`, else `null`, so Economy must read it the same day, after `settlement.tick` and before
`economy.tick` (§9); `hasFixture(market, fixture)` = the query `hasFixture(state, null, fixture, { activeOnly })`,
where `activeOnly` is the adapter's answer to Settlement's Q9 (default `false`: an idle fixture counts).)

### 4c. What Economy asks of others (not Settlement)

`PopulationProvider.headcount(market, day)` and per-capita consumption (realism's POPULATION / NUTRITION or host
data), `TransportProvider.days(from, to)` (the host's map), the day number (the host's clock). Listed so the
boundary with realism is visible; not part of this contract.

## 5. Wages and staffing (proposed)

- **Settlement** decides who fills a post and pays `Post.wage`. Wage levels are host data (Settlement Q10, open).
- **Economy** runs a **labour market** per market: it reads open and filled posts (4b) and the pool supply the host
  reports, and quotes `wageQuote(market, role, day)`: the going rate for a role under shortage or surplus. The
  host may feed the quote back into posts (the Settlement command `{ type: 'setWage', post, wage }`: settlement:
  **accepted**, added as a plain command that validates the post and a finite non-negative wage, emits no event
  and takes effect at the next wages step; whether any quote reaches it is Rex's, Q10) or ignore it. Economy never
  changes a post.
- Wage payments are Settlement's ledger rows (`wage`, subject the post id; a public-works business pays from the
  treasury's holder, otherwise the business pays). Economy's accounting reads them (§3 `rows`), never duplicates
  them.
- Household income (what a paid person then buys) is **consumption** in Economy, driven by the balance the ledger
  shows. **(open, Rex)** whether named characters' spending is simulated at all, or only pools'.

## 6. Production and consumption (proposed)

- For a **Settlement-run market**, production is Settlement's Q handed to `produce`; Economy only records it.
- For an **abstract market** (a port with no Settlement state: `ports.json` `produces` / `consumes`), Economy runs
  its own production and consumption from the five numbers. A market is one or the other, flagged in Economy's
  data (`mode: 'settlement' | 'abstract'`), so nothing is counted twice.
- **Consumption** (households, ships provisioning, a business buying its inputs from the market) is Economy's in
  both modes.
- **Equipment presence** ("the settlement has or lacks each", GOODS.md 3h) comes from Settlement's fixtures (4b
  `hasFixture`) in a Settlement-run market and from data in an abstract one. Economy's recipe check reads it; it
  never owns fixtures.
- **Spoilage** is Economy's (stock falls by the good's rule), with the data marked estimate where it is.

(settlement: agreed as written. One line on the Q, so the two engines agree on what it is: per line,
`Q = floor(min(Q_equipment, Q_labour, Q_materials, Q_utilities))`, where `Q_equipment` = fixtures of each kind the
line needs across the business's standing premises, each weighted by the building's condition band, times
`unitsPerFixtureDay`; `Q_labour` = the filled posts' worker-days (hours over `hoursPerDay`, times the labour
provider's productivity), shared across the business's lines in order, over `labourPerUnit`; `Q_materials` =
`available`; `Q_utilities` = the utility provider's capacity. Every constant is a Settlement config key, proposed.)

## 7. Prices and trade (proposed)

Economy's alone: the price per good per market from the five numbers (the formula is a config key; the
illustrative `base × (0.7 + 2.3 × shortage)` from ALIGNMENT §10 is **not** adopted until Rex says), shortage
events, orders, shipments with travel days from the host's map, duties where a government layer sets them,
organisations that own inventories and ships. Settlement sees none of this except the price it asks for.

(settlement: agreed as written.)

## 8. Accounting (proposed)

Economy offers a derived, pure view `accounts(biz, fromDay, toDay)` → revenue (sales), cost of goods (purchases,
inputs consumed at cost), wages and rent (Settlement's rows through the ledger), spoilage, profit, and the
inventory's value at market. It is a query, never state: the ledger stays the record.

(settlement: agreed as written. Note for the view: a business's money holder is the business id itself, `biz.*`;
its `Business.account` is the account record's id, `acct.*`. `rows(holder, ...)` takes the holder.)

## 9. Order of a day (proposed)

The host runs `settlement.tick(day)` first (decay, projects, staffing, production, wages, public works, expiry),
then `economy.tick(day)` (spoilage, consumption, market clearing and prices, labour-market quotes, shipments,
accounting snapshots). So a day's production is on the shelf before the day's buyers come. Both reducers are pure:
`reduce(state, command, config, providers) → { state, events }`; events are returned, never pushed; neither
engine issues the other's commands. Economy takes a seeded random source from the host where a rule needs one;
replaying the same command log gives the same state.

(settlement: agreed. Settlement's `tick` increments `settlement.day` at its end, so "day N" means: the host calls
`settlement.tick` while `state.settlement.day === N`, then `economy.tick(N)` reading `production(biz, N)`. The
material provider is called during Settlement's tick, so Economy's inventories must accept writes before
`economy.tick` runs; Economy's purity promise in §11 is "within a day", which this respects.)

## 10. Ids

Opaque strings on both sides, compared and never parsed. Economy mints `inv.*`, `mkt.*`, `ship.*`, `ord.*`,
`org.*` with Settlement's counter scheme (stable, never reused). A market id is the settlement id the host gives.

(settlement: agreed; those five prefixes are reserved for Economy in PACKAGES.md §5 and never minted by
Settlement, whose prefixes are `dist, parcel, bldg, title, lease, txn, acct, biz, post, asg, proj, office,
perm`. `pool.*` and `stl.*` are the host's.)

## 11. What each side promises

Settlement promises: the provider interfaces keep the shape Economy implements; `produce` is never called for
more than `available`; `Business.inventory` is treated as opaque; production results are queryable per day; ledger
rows for wages and rents carry the post or lease id as `subject`. (settlement: all four hold in the code today;
added: `rates` is read, never cached across ticks; the `pay` command and `setWage` keep their shapes once added;
any change to a provider interface is a new section in this file, agreed by both, before code.)

Economy promises: no import from Settlement or any game; `MaterialProvider` answers are pure within a day; stock
never goes negative; money moves only through `LedgerProvider`; it never writes a post, fixture, title or
assignment; every rule Rex has not decided is a config key or an open item in this file.

## 12. Open for Rex (collected)

1. Goods types, money versus goods, grain of goods, names, cask size (GOODS.md Open 1–8).
2. Is `port.cash` the treasury (Settlement Q7)?
3. Who values property for an unpriced sale (§4a)?
4. Is named characters' spending simulated, or only pools' (§5)?
5. The price formula and its constants (§7): a config key until then.
6. Wage levels per trade (Settlement Q10) and whether a market wage quote may move them.
8. (settlement, added 2026-10-30, s16 wages) May a payer go into debt, or does an unpaid wage stall the post?
7. (settlement, added) Does an idle fixture count for "the settlement has it" (Settlement Q9; the reader's
   `hasFixture` default is yes)?

## 13. Changes this contract asks of Settlement (each small, none blocking)

a. `MaterialProvider.rates(recipe)`; `ProductionLine` drops `unitsPerFixtureDay` and `labourPerUnit`; the stub
   recipe gains the two rates. (settlement: **accepted**.)
b. `TransactionKind` becomes `string`; `SETTLEMENT_KINDS` exported. (settlement: **accepted**.)
c. `setWage(post, wage)` command. (settlement: **accepted**.)
d. The reader in §4b is derivable from today's queries. (settlement: **confirmed**, §4b.)
e. (settlement, added) a `pay` command and a `day` range on the `ledger` query, so the host's `LedgerProvider`
   has one implementation (§3).

None is written until the economy keeper confirms this text; then a, b, c and e land in one Settlement commit
with their unit tests (U13 rates, U14 pay/setWage) and the pirate adapter's T0/A1 re-run.

## 14. Settlement keeper's reply (2026-10-30)

Agreed in substance throughout; nothing in the proposal moves a Settlement boundary. The amendments are the
marked lines above, and they are these:

1. §2, §13a: the rates come through the provider, as the economy keeper prefers; `equipment` stays on the line.
2. §3, §13b: `TransactionKind` widened to `string`, with Settlement's kinds exported as a constant.
3. §3, §13e: one implementation of `LedgerProvider` over Settlement (`balanceOf`, a new `pay` command, `ledger`
   with a day range), so the adapter does not choose.
4. §4a: the promise on `produce` made exact (integer, at most `floor(available)`, never 0); `valueOf` recorded as
   unused today, to be called only for a priced-by-provider sale once Rex answers open item 3.
5. §4b, §13d: the reader confirmed, with the day rule for `production` and the Q9 default for `hasFixture`.
6. §5, §13c: `setWage` accepted as a plain command; whether quotes reach it is Rex's.
7. §6: the Q written out so both engines mean the same by it.
8. §9: the day-number convention made explicit.
9. §12: Q9 added as open item 7.

Nothing in Settlement changes until the economy keeper confirms; then the §13 commit follows, this file is marked
agreed with the date, and the identical text is held in both repos.

## 15. Project inventories (DUP-44; proposed by the economy keeper, agreed by the settlement keeper, 2026-10-30)

`Project.account` was used both as the money holder and as the inventory ref in Settlement's project step
(`Toolchain/GRAPH.md` DUP-44). Agreed:

- `Project` gains `inventory: string`, an opaque inventory ref like `Business.inventory`.
- The project step draws materials through `have` / `take` on `inventory`, and pays wages from `account` exactly
  as before.
- `startProject` takes `inventory` optionally, defaulting to `account`, so existing logs and the hamlet replay are
  unchanged.
- The pirate adapter resolves it through the economy adapter's aliases as it does business refs.
- This supersedes the §2 note that a project's materials are drawn from `Project.account`.

Timing: before the kernel adoption, so the kernel's byte-identity baseline is taken after the fix. Settlement's
test: U16 (materials from `project.inventory`, wages from `project.account`, the default for old callers).

## 16. Labour (DUP-26, DUP-28, DUP-29; Rex approved the owners 2026-10-30; AGREED 2026-10-30: the economy keeper's P1.md rev 2 text with the settlement keeper's amendments A and B)

- **One unit, person-hours.** A recipe's labour requirement is `rates.labourHoursPerUnit` (person-hours per output
  unit), replacing `labourPerUnit` (worker-days). Settlement's labour cap per line is the filled posts'
  `hours × productivity`, shared as `config.labourSharing` says, over `labourHoursPerUnit`. Data converts once at
  `labourHoursPerUnit = labourPerUnit × 10` (Settlement's `hoursPerDay` today), so results do not move.
  `hoursPerDay` stays Settlement's config for projects' worker-days (SET-12: 10 today, 11 in Voth; Rex's). (settlement: amended: projects move to person-hours too, `Project.labourHours` = `labourDays` x 10 once, and a project's per-day wage pays `wage x hours / hoursPerDay`, so results do not move; `hoursPerDay` is then the one number where days and hours meet, which the host also passes to the population's `personHours`.)
- **One interface, `LabourSupply`**, declared with this exact text in both engines' `providers.ts`, implemented by
  the population model (Reality in the interim, Society later) or the host, stubbed in each engine's tests:

  ```ts
  export interface LabourRow { category: string; persons: number; personHours: number }

  export interface LabourSupply {
    /** The population's supply today by category (adult men, adult women, elders, children: Reality's
     *  categories); persons = cohort × health × (1 − sick share), health applied once; personHours = persons ×
     *  the host's hours per day (one number, Settlement's `hoursPerDay`, SET-12). */
    supply(day: number): LabourRow[]
    /** False while a person is aboard, dead or away: the host knows, the engines do not. */
    available(person: string, day: number): boolean
    /** Person-hours a person or a pool offers for a role today. */
    hours(source: string, role: string, day: number): number
    /** Person-hours a pool grants a post today: at most `wantedHours` and at most what it has not granted yet. */
    draw(pool: string, role: string, requires: unknown, wantedHours: number, day: number): number
    /** 0..n output factor of a holder in a role; the host maps skill bands to it. */
    productivity(holder: string, role: string): number
  }
  ```

  It replaces Settlement's `LabourProvider` and Economy's `LabourSupplyProvider`. One type, one implementation per
  host, composed: the population model (Reality in the interim) answers `supply`, and `hours` and `draw` for
  pools (a pool id names its categories, host data); the host answers `available` and `productivity` for named
  persons. A pool's `hours` is the sum of its categories' `personHours`.
- **Assignment never exceeds supply.** Settlement assigns: on any day the hours it fills from a source never exceed
  `hours(source, role, day)` (a person) or the pool's grants (a pool).
- **Sharing across lines** is `config.labourSharing`: `'in-order'` (today's rule, the default) until Rex answers
  Q15; any other value throws "open for Rex (Q15)".
- **Wages.** Economy's `wageQuote(market, role, day)` sets the level by `config.wageRule` (default `posted-median`);
  the host applies a quote to a post only through Settlement's `setWage`, before Settlement's tick; Settlement's
  `pay` executes it. Whether a quote may move a wage at all, and the levels, are Rex's (Q10, §12.6). Whether a
  payer may go into debt is recorded for Rex, not decided.
- **Inventories (DUP-44, follow-up to §15).** Settlement's loader takes an optional `inventoryOf(place, biz)` so the
  host mints each business's inventory in the economy at replay time; the economy adapter's alias table then retires.
  (settlement: amended: Settlement adds the command `{ type: 'setInventory', biz, inventory }` that rebinds a
  business's inventory ref; the loader issues it right after `openBusiness`, so the business id exists when the
  hook mints its inventory.)

## 17. Provider queries are pure (proposed by the settlement keeper, agreed by the economy keeper, 2026-10-30)

Production calls `materials.rates` and `materials.available` twice per line per tick (the Q20 prepass, then the
production pass), as well as the host's `labour.productivity` and `utilities.capacity`. Each query must be pure: no
state change, and the same answer for the same arguments within a tick. This supersedes §4a's 'read once per line per
tick' note on `rates`. `produce` and `take` are not queries and are called at most once per line.

## 18. What `hours` returns, and named holders in a wage quote (proposed by the economy keeper, agreed by the settlement keeper, 2026-10-30)

`LabourSupply.hours(source, role, day)` returns what the source has left after that day's grants, not its capacity
(persons × hours per day); a client that wants capacity reads it before the day's grants. In a wage quote, a named
holder offers the hours of the posts they hold, capped at those posts' hours, because a named person's supply is
otherwise unbounded and the quote would not be finite. A quote that is null or not finite is skipped and no
`setWage` is issued for it.

## 19. A person's reservation wage (IF-27; proposed by the economy keeper, agreed by the settlement keeper, 2026-11-01)

`LabourSupply` gains one optional pure query (§17), declared beside the §16 block and leaving that block unchanged:

```ts
/** The least wage, in money per filled post-day (as `Post.wage`), a named person asks for a role today; null
 *  when none is stated. The host answers it from the person's latest `work` intention (`terms.wage_min`). */
reservationWage?(person: string, role: string, day: number): number | null
```

Only the economy calls it: in a wage quote, a named holder's offer is floored at their reservation wage. Settlement
never calls it, and staffing gains no rule: whether a person works for less than they asked is the person's decision
(Cognition). A mind that will not work at a post's wage says so with a `refuse_work` intention, after which
`hours(person, role, day)` returns 0 and staffing, which already caps a person at `hours`, assigns nothing. A
provider without the method answers as if it returned null.

## 20. Money and goods in one transfer (proposed by the economy keeper, agreed by the settlement keeper, 2026-11-01)

A sale or purchase moves its money and its goods in one kernel `transfer()`, so both legs commit or neither does.
`LedgerProvider.transfer` gains one optional argument, declared beside §3 and leaving its other arguments unchanged:

```ts
/** The goods leg of a paid exchange. `ledger` is the economy's goods TransferLedger, built by the economy inside
 *  the command that calls `transfer`; `from` and `to` are its accounts (inventory ids), `good` its quantity (a good
 *  id), `units` the amount (a finite number >= 0; fractions allowed). */
goods?: { ledger: TransferLedger; from: string; to: string; good: string; units: number }
```

The host is the seam. It puts the data `{ from, to, good, units }` into Settlement's `pay` command as
`goods?: { from, to, good, units }` and passes the live ledger beside the command, never in it, as
`reduce(state, cmd, config, providers, opts?: { goods?: TransferLedger })` and `Runner.run(cmd, opts?)`. The command
log stays plain JSON; `opts` is never logged.

Settlement's `pay` with `goods` data and a ledger in `opts` builds one `transfer()` with the money leg on
`moneyLedger(ctx)` and the goods leg on that ledger, and writes its existing ledger row (the caller's kind, `sale` or
`purchase`) only after the transfer returns; `pay` emits no event today and gains none. If either leg throws, the
kernel restores both ledgers, `pay` throws, and nothing is logged. The batch is the money request then the goods
request, both at the settlement's day (`t = day * 86_400_000`); the goods request's process is `economy.trade.trade`.
Zero `units` means no goods request: the money leg runs alone. A zero `amount` (or a holder paying itself) means no
money request, as today: the goods leg runs alone. With neither, only the row is written, as today. A `pay` with a
ledger in `opts` and no `goods` data is an error. `pay` without `goods` is byte-identical to today.

Replay is exact, not a fallback. A `pay` whose batch failed threw and was never logged, so every logged `pay` with
`goods` committed both legs; the goods leg writes only economy state, never a settlement key. So a `pay` with
`goods` data and no ledger in `opts` (a Settlement-only replay) moves the money leg alone and reproduces
Settlement's state byte for byte. The host's joint replay re-runs the economy's command, which rebuilds the goods
leg on its side.

The economy's `buy` and `sell` call `transfer` with `goods`, with the ledger built on their own command's state, so
every goods write stays inside an economy command. They no longer move the goods themselves after the money. A
trade with the market's own stall (one inventory on both sides) passes no `goods`. Goods moves without money
(shipments, production, consumption, spoilage, take, takeMass, addMass, addStock) never go through `pay`; freight
stays its own `freight` row. No leg refuses on balance: Q19 and ECON-26 stay open for Rex.

## Log

| Date | What |
|---|---|
| 2026-10-30 | Proposal written and sent to the settlement keeper (economy keeper) |
| 2026-10-30 | Counter-proposal with inline amendments and §14 returned to the economy keeper (settlement keeper) |
| 2026-10-30 | All nine amendments confirmed by the economy keeper; §13 a, b, c, e landed in Settlement with U13, U14; agreed |
| 2026-10-30 | §15 (DUP-44, `Project.inventory`) proposed by the economy keeper, agreed and landed in Settlement with U16 |
| 2026-10-30 | §16 AGREED: the economy keeper's P1.md rev 2 text (Reality's supply rows) with the settlement keeper's amendments A (projects in person-hours) and B (`setInventory`); the settlement draft (3cd7bd8) and its interim agreed form (828091f) are withdrawn. From here, a change to §16 is a new section agreed by both keepers, never a swap of drafts |
| 2026-10-30 | §17 (provider queries are pure) proposed by the settlement keeper after its Q20 prepass, agreed by the economy keeper; the economy adapter's `available` and `have` no longer mint an inventory for an unseen ref (pirate 6383414) |
| 2026-10-30 | §18 (what `hours` returns; named holders in a wage quote) proposed by the economy keeper after reverting its lane's in-place edit of §16 (economy 4fb822a, d3ad33d), agreed by the settlement keeper: Settlement's `StubLabourSupply.hours` returns what is left after the day's grants and staffing caps a named holder at the post's hours |
| 2026-11-01 | §19 (a person's reservation wage, IF-27) proposed by the economy keeper, agreed by the settlement keeper: an optional pure query read only by the economy's wage quote; no staffing rule (the decision is the person's, Cognition) |
| 2026-11-01 | §20 (money and goods in one transfer) proposed by the economy keeper, agreed by the settlement keeper with five amendments (settlement's `reduce`/`Runner.run` seam, no event, batch order and time, each leg skipped on its own zero): Settlement's `pay` takes an optional goods leg as data and the live ledger in `opts`; Settlement-only replay moves the money leg alone, exactly |
