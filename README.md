# Khaata

A local-first expense tracker built around buckets. No bank login, no cloud, no build step. Your data is a JSON file on your own computer.

Khaata does **not** log into your bank. It keeps itself current from bank/UPI alerts you forward to its own ingest endpoint (see below), or from manual entries. That keeps it legal, private, and independent of any one bank's API.

Built for one person with one salary: bills are funded first, the rest is split across spending buckets by percentage, and leftovers for clothes/electronics carry forward up to a maximum.

## Use it in one minute

1. **Salary day:** add the salary as **Received**, then press **Divide salary**.
2. **When you spend:** press **Add expense** and choose a bucket.
3. **If the big number looks wrong:** press **Check bank balance** and type what your bank app shows.
4. **Next month:** repeat. That's it.

If you set up after the salary already landed, do not add it again — it is already in your bank balance.

## Run it

Requires Node 20 or newer.

```bash
npm start
```

Open **http://127.0.0.1:4321**.

There are no dependencies to install.

## First run

Enter two numbers:

1. **Monthly salary (take-home)** — what actually reaches your bank.
2. **Money in your bank right now** — what is in the account today.

If the balance is enough to cover the whole monthly plan, the app divides it immediately. If salary hasn't landed yet, it leaves the money undivided and tells you; add the salary as **Received** and divide it once it arrives.

The seeded plan is a template for ₹1,00,000. Edit every amount in **Plan** before trusting it: your rent, EMI and SIP are yours, not the defaults. There is also a **See an example first** button on the setup screen.

## When salary arrives

1. Press **Add income** on Home.
2. Enter the amount and save.
3. The app immediately opens **Divide this month's salary**. Press **Divide salary**.

If the month is already divided, extra money shows as **not divided**. Open **Move money**, choose **From: Not divided**, pick the bucket, and move it there. Or leave it for next month. Dates cannot be in the future: the app records money after it has actually moved.

## If the bank does not match

The big number is a record of what you logged, not a live bank feed.

- **Bank shows less:** usually a missed expense. Press **Check balance** → **Record missing expense**, then choose the bucket.
- **Bank shows more:** usually missed income or a refund. Press **Check balance** → **Record missing income**.
- **Bank charge, interest, or a tiny rounding difference:** press **Check balance** → **Just match totals**.

Matching totals only changes **Not divided**. It never changes bucket balances. If matching would make buckets short, record the expense instead or use **Move money** → **To: Not divided** to take money out of a bucket.

## Bucket types

Each bucket has a type. The type decides how much it gets and which movements are allowed.

| Type | Allocation | Accepts | Leftover |
|---|---|---|---|
| **Bill** | fixed rupee amount | Spent, Refund | Starts fresh |
| **Saving** | fixed rupee amount | Set aside, Money back | Stays |
| **Investment** | fixed rupee amount | Set aside, Money back | Stays, optional Max |
| **Loan** | fixed rupee amount | Set aside, Money back | Starts fresh |
| **Spending** | percentage of what is left | Spent, Refund | Starts fresh, or stays for clothes/electronics |

**You can add as many bills, savings, investments and loans as you want.** Each one has its own name, amount, Keep setting and Max. For example: “HDFC SIP” and “PPF” are two investment buckets; “Home loan” and “Education loan” are two loan buckets.

The rules are enforced:

- Bills and spending buckets only accept **Spent** and **Refund**. They cannot receive savings or investment money.
- Savings, investments and loans only accept **Set aside** and **Money back**. You cannot mark a coffee as “Spent” from an investment bucket.
- Salary/income always goes to **Not divided**, never directly into a bucket.
- Moving money between buckets is always allowed, because it is an explicit relabel. To spend from an investment, first **Move money** to a spending bucket, then log the spend.

## Monthly ticks

Fixed buckets show a green tick when the month's plan for that bucket is covered:

| Type | Tick when |
|---|---|
| **Bill** | This month's `Spent` (minus refunds) reaches the target |
| **Saving** | The monthly amount is funded by **Divide salary**. Savings kept in the bank count as saved |
| **Investment** | This month's `Set aside` (minus money back) reaches the target |
| **Loan** | This month's `Set aside` loan payment reaches the target |
| **Spending** | No tick; it is ongoing |

The tick is derived from this month's activity and the monthly division target — not from the bucket balance. That means:

- A savings bucket with last year's money does **not** tick just because its balance is high.
- A bill bucket at zero does **not** tick just because its balance is zero.
- A refund, bounced EMI, edited amount or deleted payment updates the tick automatically.
- The transaction date decides which month a payment counts in. A payment dated last month does not tick this month.
- Extra payments are allowed. The app shows a warning, but never blocks them.
- A bucket added after the month's division shows **“Added after this month's division”** and starts ticking next month.

## The model

- **Bills** (rent, utilities), **savings** (emergency fund), **investments** (SIP, PPF) and **loans** (EMIs) are fixed rupee amounts, set aside first.
- **Spending buckets** (groceries, transport, clothes, electronics, fun, misc) split whatever is left by percentage.
- **Spending percentages must add up to 100%.**
- **Keep leftover** means that bucket keeps its balance next month. **Max** stops it growing forever. Bills, loans, groceries and fun start fresh instead.
- **One division per calendar month.** It fills each bucket from the undivided bank balance. Extra money goes to the chosen bucket (Emergency by default).
- **Undo is available until money moves.** Once you record spending or move money between buckets, the division locks and you adjust buckets instead.
- **The bank balance never changes when you divide or move money.** Dividing is just labelling money that is already there.
- Buckets are virtual. The bank only knows one balance. Sum of buckets + undivided money always equals the real bank balance.

### Why not split the current balance by percentage continuously?

Because then buying clothes quietly shrinks your rent and EMI capacity, and no bucket can ever reach zero. Percentages are a **division rule**, applied once per payday, not a live lens on the balance.

### What counts as what

| Action | Transaction type | Bucket type |
|---|---|---|
| Rent, utilities | Spent | Bill |
| Groceries, clothes, fun | Spent | Spending |
| Salary, interest | Received | Not divided (no bucket) |
| SIP, PPF, stocks | Set aside | Investment |
| Emergency fund deposit | Set aside | Saving |
| Loan EMI | Set aside | Loan |
| Withdrawal / redemption | Money back | Saving / investment / loan |
| Return / cashback | Refund | Spending / bill |
| Bank mismatch | Check bank balance | Balance fix, no bucket |

## Daily use

- **Log a spend:** click `+` on a spending or bill bucket, or **Add expense**.
- **Salary day:** add the credit as **Received**, then **Divide salary** on Home.
- **Overspent a bucket:** **Move money** from another bucket to cover it.
- **Save, invest or pay a loan:** click `+` on that bucket. The button says Save, Invest or Pay.
- **Check against the bank:** **Check bank balance** whenever you want.
- **Stuck?** Click **How to use** in the sidebar (or the `?` on mobile).

## Automatic updates from bank / UPI alerts

The app has an ingest endpoint. Your phone can POST each alert to it; the app records the transaction, guesses the bucket, and optionally matches the balance in the alert.

Useful fields:

| Field | Required | Notes |
|---|---|---|
| `amount` | yes | In **rupees**, e.g. `450.50` (₹ and commas are tolerated) |
| `direction` | yes | `"out"` or `"in"` |
| `description` | yes | Merchant / narration |
| `balance` | no | Available balance from the alert, in rupees. Matches automatically. |
| `date` | no | `YYYY-MM-DD`, defaults to today |
| `category` | no | Bucket name, e.g. `"Fun"` |
| `externalId` | no | Unique alert id. Sending the same id twice is ignored. |
| `kind` | no | `expense`, `income`, `transfer`; defaults from direction |

```bash
curl -s -X POST http://127.0.0.1:4321/api/ingest \
  -H 'content-type: application/json' \
  -H 'x-ingest-token: YOUR_TOKEN' \
  -d '{"amount":450.50,"direction":"out","description":"Swiggy","balance":52187.50,"externalId":"sms-9182"}'
```

The token and a copy-ready curl snippet are in **Settings → Optional: automatic updates**. This section is collapsed until you need it.

- **iPhone:** Shortcuts → Automation → SMS/email from your bank → Get Contents of URL → POST JSON. iOS cannot read other apps' notifications.
- **Android:** Tasker or MacroDroid → notification from your bank/UPI app → HTTP POST. This is the closest to instant.
- To reach the server from your phone, run `HOST=0.0.0.0 npm start` and use your Mac's LAN IP. Keep the token private; it can write to your data.

Checking the bank balance is what keeps this honest: alerts can be missed, duplicated or delayed. One real balance check a day corrects everything.

## Data and security

- Ledger: `data/store.json`; previous version: `data/store.json.bak`.
- **Settings → Backup** downloads a copy and can **restore** one. Restoring replaces all current data.
- If the main file is ever damaged, the app recovers from `store.json.bak` on startup and keeps the damaged copy as `store.json.corrupt`.
- The UI has no login because it binds to `127.0.0.1` only. Do not expose this server directly to the internet. For remote access, use a VPN such as Tailscale.
- The ingest token is the only write credential. Rotate it in Settings if it leaks.
- Never scrape your bank's website or store bank passwords. If you later connect a real bank API, use a licensed aggregator (RBI Account Aggregator in India, Plaid/TrueLayer elsewhere) with read-only consent.

## Known limits

- Khaata is a **record of cash movements**, not a live bank connection. It only knows what you log or send to the ingest endpoint.
- Investment buckets track money moved toward investing, not portfolio value. Loan buckets track money paid toward an EMI, not the outstanding loan balance.
- It handles one bank balance. Split accounts, credit cards and cash wallets are not separate ledgers.
- The starting balance is captured when you set up. Do not re-add transactions that happened before setup; they are already inside that balance.
- A bucket's type is chosen when it is created. To change it, move its balance to **Not divided**, remove it, and add it under the new type.
- Dates cannot be in the future. The app records money after it moves.
- One division per calendar month; corrections after spending are made with **Move money**, not a re-division.

## Development

```bash
npm test        # money-engine and store tests: division, types, leftovers, max, undo, balance checks, recovery
npm run dev     # restart on server changes
```

Layout:

- `lib/domain.js` — money engine. All amounts are integer paise; no floats.
- `lib/seed.js` — default plan and demo data.
- `lib/store.js` — atomic JSON persistence.
- `server.js` — zero-dependency HTTP API and static server.
- `public/` — vanilla JS/CSS client, no build step.

### API summary

- `GET /api/state`
- `POST /api/setup` `{ mode: "fresh"|"demo", monthlyIncomePaise, openingBalancePaise }`
- `POST /api/restore` — replace the ledger with an exported backup
- `POST /api/transactions` · `PUT/DELETE /api/transactions/:id`
- `PUT /api/plan` — full plan (`monthlyIncomePaise`, `paydayDay`, `surplusCategoryId`, `categories[]`)
- `POST /api/allocate` · `POST /api/allocations/:id/undo`
- `POST /api/reconcile` `{ balancePaise }`
- `POST /api/move` `{ fromCategoryId, toCategoryId, amountPaise }`
- `POST /api/ingest` — token-authenticated, amounts in rupees
- `GET /api/export`

## Roadmap

1. CSV / bank statement import, with column mapping.
2. Email-alert ingester running locally (Gmail API or IMAP).
3. Recurring templates for rent, EMI and SIP.
4. Read-only account-aggregator sync where available.
5. PWA install + home-screen widget.
