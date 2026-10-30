# Khaata

A local expense tracker and salary budget. One tracked bank balance, virtual buckets, manual investment values, and no bank login or cloud service.

## Run

Requires Node 20 or newer. There are no dependencies to install.

```sh
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

**Available to spend** is funded spending money after protecting bills, goals, and next month's reserved cash. It is based on what you have logged, not a bank feed. The daily guide divides that amount by the days until your configured payday.

## Funding and months

Bills and loans come first. With partial funding, the built-in Groceries, Transport and Misc buckets come next, followed by savings, investments, and other spending. Use Move money to adjust priorities for your own plan.

A month has one saved plan and can receive multiple funding instalments. Top-ups fill the remaining plan without resetting spending or adding the monthly target twice. Changes to Plan affect subsequent funding months; a funded month keeps its saved rules.

You can fund **this month or next month**. Future funding is held separately and does not reset this month's buckets. It activates when the month begins. Next month's overview shows its planned balances, while this month's overview excludes that reservation from available spending.

A transaction's **Date** is when cash moved. **Budget month** identifies the budget or bill it covers, so early rent and late EMIs can be assigned correctly. Transaction history and cash-flow totals still use the actual date.

The accounting relationship is:

```text
Bank balance = current bucket balances + future reservations + unassigned money
```

Amounts are stored as integer paise. Money inputs accept exact rupees and paise.

## Bills and goals

- **Bills / loans:** record payments, and select **This bill is fully paid** when settled. A variable bill can cost less than its budget. Click its name to change the actual amount, due day through Plan, covered month, or paid status. Unpaid obligations remain visible, including months you did not fund.
- **Savings:** funding money held in your bank counts toward the monthly goal. Moving it into spending reduces retained savings progress. A capped goal can show **Goal reached** without claiming a new contribution.
- **Investments:** reserved cash and investment market value are separate. Record contributions as **Money moved out**, genuine redemptions as **Withdrawal**, and failed payments using **Payment failed / returned** on the original entry.
- **Spending:** percentages split what remains after fixed goals. Positive leftovers carry only when Keep leftover is enabled; negative balances always carry. A maximum limits buildup.

The overspending notice shows when positive buckets are not fully backed by cash. Covering an overspend suggests unassigned or discretionary money first, and warns when a move reduces a bill or goal's reservation.

## Investment values

Expand **Investments** and choose **Update**. Enter the current value and declare the opening history once:

- No holdings before Khaata: opening cost is zero.
- Existing holdings: enter the cost of the holdings you owned when you started.
- Unknown history: leave gain/loss hidden.

Gain/loss is current value plus recorded redemptions minus recorded successful contributions and opening cost. Returned failed payments do not count as contributions or redemptions. Values become stale after movements, edits, or deletions until updated. Pausing or removing a cash-empty investment bucket keeps its holding visible. A bucket with pending cash cannot be removed until that money is moved.

This is a cash ledger with manual values, not a portfolio accounting system. It does not fetch prices, dividends, taxes or investment units.

## Corrections and history

New budgets save the rules needed to replay dated activity. Late entries and edits recalculate affected balances and surplus using those saved rules.

If a difference was already included by **Check bank balance**, classify that correction instead of entering the same movement again. You can classify part of a correction. Deleting a classified entry restores the unidentified correction and preserves the bank total.

**Older ledgers:** existing divisions without rule snapshots keep their exact effects. The app cannot reconstruct settings that were never stored. Entries before that history boundary require a correction dated today. Existing balances are preserved; there is no automatic reset.

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
- `lib/seed.js`: initial template and example data.
- `server.js`: local HTTP API.
- `public/`: buildless JavaScript and responsive CSS.
