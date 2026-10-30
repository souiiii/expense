# Khaata

A local expense tracker and salary budget. One tracked bank balance, virtual buckets, manual investment values, and no bank login. Optional Neon cloud storage sync runs behind the existing local backend.

## Run

Requires Node 20.12 or newer.

```sh
npm install
npm start
```

Open **http://127.0.0.1:4321**. Restart the server after updating the application.

## First use

1. Enter your expected take-home salary and current bank balance.
2. Review **Plan**: set your actual bills, savings, investments, and spending shares. The starting amounts are examples.
3. For bills already paid before your starting balance, open the row's **⋯** options and select **Already paid this month**.
4. Save the plan, then **Fund month**.

Setup does not divide your money automatically. Your opening balance already includes earlier activity; only log new transactions after that balance. The starting date prevents transactions from earlier dates being counted again. On the starting day, take care not to re-enter payments already included in the balance.

## Day to day

- **Expense:** record what you paid and the bucket it belongs to.
- **Income:** record salary or other money received. Choose the month you want to fund next.
- **Fund month:** preview the resulting balances. If cash is short, fund essentials now and **Top up** when the rest arrives.
- **Move money:** relabel money between buckets or Unassigned. This does not change the bank total.
- **Check bank balance:** match your recorded balance to your bank. Identify the resulting correction as an expense, income, refund, or transfer when you know its cause.
- **Activity:** view transactions, funding and budget moves by month.

**Available to spend** is funded spending money after protecting bills, goals, next month's reserved cash, and bills due before your next configured payday. Existing reservations and early payments are counted once. A bill without a due day is treated as due on the first for this protection; bills due on payday itself are assumed to use that payday's income. It is based on what you have logged, not a bank feed.

The daily guide excludes planned-purchase buckets. Rollover spending buckets are excluded by default; change **Include in daily spending guide** in the bucket's Rules to override this. Their money remains available for the planned purchase.

## Funding and months

Partial funding follows the priority configured on each bucket type (1 first, 4 last), with an optional override in each bucket's Rules. Equal priorities follow the saved bucket order. The preview lists this order. New budgets save these priorities so later changes cannot rewrite their funding. Older snapshots without priority fields retain their original funding order.

A month has one saved plan and can receive multiple funding instalments. Top-ups fill the remaining plan without resetting spending or adding the monthly target twice. Changes to existing Plan rules affect subsequent funding months; a funded month keeps its saved rules. New bills are the exception: their first due month determines when the obligation starts. A new bill joins any affected current or next-month funded budget with zero funding, so its shortage is visible and Top up can fund it. Moving money into it also counts toward funding. To change an existing bill's current amount, use its Details.

You can fund **this month or next month**. Future funding is held separately and does not reset this month's buckets. It activates when the month begins. Next month's overview shows its planned balances, while this month's overview excludes that reservation from available spending.

A transaction's **Date** is when cash moved. The budget month follows this date until you explicitly override it. **Budget month** identifies the budget or bill it covers, so early rent and late EMIs can be assigned correctly. Transaction history and cash-flow totals still use the actual date.

The accounting relationship is:

```text
Bank balance = current bucket balances + future reservations + unassigned money
```

Amounts are stored as integer paise. Money inputs accept exact rupees and paise.

## Bills and goals

- **Bills / loans:** record payments. Partial payments retain the outstanding amount; the settlement checkbox starts unchecked. Select **This bill is fully paid** explicitly to settle below the expected amount. A variable bill can cost less than its budget. Click its name to change the actual amount, due day through Plan, covered month, or paid status. Unpaid obligations remain visible, including months you did not fund.
- **Savings:** funding money held in your bank counts toward the monthly goal. New savings transfers increase the external savings balance; withdrawals decrease it. Details lets you check or correct that external balance with a dated adjustment. Moving it into spending reduces retained savings progress. A capped goal can show **Goal reached** without claiming a new contribution.
- **Investments:** reserved cash and investment market value are separate. Record contributions as **Money moved out**, genuine redemptions as **Withdrawal**, and failed payments using **Payment failed / returned** on the original entry.
- **Spending:** percentages split what remains after fixed goals. Positive leftovers carry only when Keep leftover is enabled; negative balances always carry. A maximum limits buildup.

The overspending notice shows when positive buckets are not fully backed by cash. Covering an overspend suggests unassigned or discretionary money first, and warns when a move reduces a bill or goal's reservation.

Bill Rules also support monthly, quarterly, yearly, and one-off payments, with first and optional last due months. The entered amount is the amount of each scheduled payment. Funding requests it in the due month; use a separate savings goal to build up cash beforehand. A finished EMI stops creating new obligations after its last due month, while any unpaid earlier instalments remain due.

Changing a type's accounting behavior is blocked once its buckets have financial history. Create a new type/bucket instead; existing entries and holdings retain their original meaning.

## Investment values

Expand **Investments** and choose **Update**. Enter the current value and declare the opening history once:

- No holdings before Khaata: opening cost is zero.
- Existing holdings: enter the cost of the holdings you owned when you started.
- Unknown history: leave gain/loss hidden.

Gain/loss is current value plus recorded redemptions minus recorded successful contributions and opening cost. Returned failed payments do not count as contributions or redemptions. Values become stale after movements, edits, or deletions until updated. Each value has an as-of date; historical views use only valuations on or before month-end and show no value when one was never recorded. Portfolio totals explicitly identify incomplete values and partial known gains. Pausing or removing a cash-empty investment bucket keeps its holding visible. A bucket with pending cash cannot be removed until that money is moved. A paused holding still accepts withdrawals and returned payments; incoming money goes to Unassigned, and new contributions remain blocked.

This is a cash ledger with manual values, not a portfolio accounting system. It does not fetch prices, dividends, taxes or investment units.

## Corrections and history

New budgets save the rules needed to replay dated activity. Late entries and edits recalculate affected balances and surplus using those saved rules.

If a difference was already included by **Check bank balance**, classify that correction instead of entering the same movement again. You can classify part of a correction. Deleting a classified entry restores the unidentified correction and preserves the bank total.

**Older ledgers:** existing divisions without rule snapshots keep their exact effects. The app cannot reconstruct settings that were never stored. Entries before that history boundary require a correction dated today. Existing balances are preserved; there is no automatic reset.

## Compatibility with existing data

Existing bank and bucket balances are retained. New schedule fields default to monthly behavior, and existing investment values retain their original recording date. Earlier savings transfers are not added to the external balance again, because they may already be included in a manually entered external amount. Check that amount once in Savings Details; subsequent transfers and withdrawals update it automatically. Backups include schedules, saved priorities, external savings adjustments and dated valuations.

## Data and backups

- Current ledger: `data/store.json`.
- Previous file version: `data/store.json.bak`.
- Download and restore backups in **Settings → Your data**. Restore replaces the current ledger after validation.
- If the main JSON file is damaged, startup attempts recovery from `.bak` and retains the damaged file as `.corrupt`.

The server binds to `127.0.0.1` by default and has no login. Keep it local. Separate bank accounts, credit cards and cash wallets are outside the current model.

## Optional alerts

The existing token-authenticated ingest endpoint remains available for local bank/UPI alert automation. Endpoint and token are under **Settings → Automatic updates**. Bank connections are not required for normal use.

```sh
curl -X POST http://127.0.0.1:4321/api/ingest \
  -H 'content-type: application/json' \
  -H 'x-ingest-token: YOUR_TOKEN' \
  -d '{"amount":450.50,"direction":"out","description":"Groceries","externalId":"alert-123"}'
```

Amounts at this endpoint are rupees. Manual API endpoints use paise. An optional alert `balance` creates a reconciliation adjustment. Review unidentified corrections rather than treating a matched total as proof that every transaction is categorized correctly.

## Development

```sh
npm test          # money, history, syntax and persistence regression tests
npm run test:api  # API checks with a disposable ledger and temporary local port
npm run dev      # restart when server code changes
```

The API checks also execute view templates without a browser. This does not replace visual or native-browser validation.

- `lib/domain.js`: validation, commands, summaries and client state.
- `lib/budget.js`: dated budget replay and saved rules.
- `lib/store.js`: atomic JSON persistence and recovery.
- `lib/cloud-sync.js`: durable background sync and conflict protection.
- `lib/neon.js`: Neon PostgreSQL storage adapter.
- `lib/seed.js`: initial template and example data.
- `server.js`: local HTTP API.
- `public/`: buildless JavaScript and responsive CSS.

## Optional Neon cloud storage

The app continues to read and save locally. Cloud requests never sit in the path
of opening the app or recording a transaction. The UI, API responses, paise
amounts, budgeting rules and calculations stay the same.

1. Create a Neon project and copy its PostgreSQL connection string from **Connect**.
2. Copy `.env.example` to `.env` in this repository.
3. Set `DATABASE_URL` in `.env` to that connection string. Keep it private;
   `.env` is ignored by Git and is never served to the browser.
4. Run `npm install`, then restart with `npm start`.

The backend creates `public.khaata_ledgers` automatically. Each ledger is stored
as one JSONB document so existing history and domain rules are preserved exactly.
An empty cloud ledger receives your existing local data on its first sync; no
reset or manual re-entry is needed. Leave `CLOUD_LEDGER_ID=personal` stable.
Different IDs select separate ledgers in the same database.

Each local save queues a background upload after 250 milliseconds. Multiple
nearby saves are combined. The saved `_cloudSync` bookkeeping inside
`data/store.json` records the last cloud revision and any in-flight snapshot;
it is excluded from domain state and downloaded backups. Changes survive
connection failures and restarts, including an upload whose response was lost.
Only one sync request sequence runs at a time.

The backend also checks for cloud updates/retries every 60 seconds while it is
running. Set `CLOUD_SYNC_INTERVAL_MS` to change that interval. Frequent checks
can keep Neon compute awake and consume its free compute allowance; use a
longer interval if needed. New local saves still trigger a prompt sync.

Inspect sync without changing the UI:

```sh
curl http://127.0.0.1:4321/api/sync
```

The response reports `enabled`, `state` (`pending`, `syncing`, `synced`,
`offline`, or `conflict`), `pending`, `lastSyncedAt`, and a sanitized `error`.
With no `DATABASE_URL`, sync is disabled and the app runs locally as before.
Cloud failures are reported in the server terminal; local saves keep working.

Cloud changes replace the local copy only when it has no unsynced edits, or
when a newly created, untouched installation is loading its ledger for the
first time. Downloads pass the existing backup and budget validation first.
Writes use atomic revision checks. Divergent edits are never automatically
merged or resolved by timestamps.

### Cloud recovery

If `/api/sync` reports `conflict`, both ledgers remain intact and automatic
uploads pause until the conflict is resolved. Stop the backend and preserve
`data/store.json` and `data/store.json.bak` before recovery.

- **Use the cloud copy:** start with a new local file, for example
  `DATA_FILE=data/cloud-recovery.json npm start`. The existing local file stays
  intact. The untouched new file downloads the cloud ledger in the background;
  wait for `/api/sync` to report `synced` before editing. Keep using that
  `DATA_FILE` afterward. Reload the page after the initial download.
- **Use the local copy:** keep your original local file and select a new unused
  `CLOUD_LEDGER_ID` in `.env`, such as `personal-recovered-1`, then restart.
  This uploads the local copy into a separate row without overwriting the
  conflicting cloud copy. Keep the new ID afterward.
- **Keep changes from both:** preserve both copies and review their JSON
  backups before combining anything. There is no automatic financial-history
  merge.

Cloud sync is a second copy, not versioned backup history: intentional deletes,
reset and restore also sync. Continue downloading backups. Only the backend
holds database credentials. Your computer must remain on to use the app from
your phone or sync to Neon; this does not add browser-offline support or a
hosted backend. Keep the server local as described above.
