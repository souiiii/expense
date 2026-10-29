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

## The model

- **Bills & savings** (rent, loan EMI, SIP, emergency) are fixed rupee amounts, set aside first.
- **Spending buckets** (groceries, transport, clothes, electronics, fun, misc) split whatever is left by percentage.
- **Spending percentages must add up to 100%.**
- **Keep leftover** means that bucket keeps its balance next month. **Max** stops it growing forever. Groceries and fun start fresh instead.
- **One division per calendar month.** It fills each bucket from the undivided bank balance. Extra money goes to the chosen bucket (Emergency by default).
- **Undo is available until money moves.** Once you record spending or move money between buckets, the division locks and you adjust buckets instead.
- **The bank balance never changes when you divide or move money.** Dividing is just labelling money that is already there.
- Buckets are virtual. The bank only knows one balance. Sum of buckets + undivided money always equals the real bank balance.

### Why not split the current balance by percentage continuously?

Because then buying clothes quietly shrinks your rent and EMI capacity, and no bucket can ever reach zero. Percentages are a **division rule**, applied once per payday, not a live lens on the balance.

### What counts as what

| Action | Transaction type | Effect |
|---|---|---|
| Rent, groceries, clothes | Spent | Bucket goes down, counted as spending |
| Salary, interest | Received | Undivided money goes up |
| SIP, FD, broker transfer | Invested | Bucket goes down, **not** counted as spending |
| Return / cashback | Refund | Money goes back into the bucket |
| Bank mismatch | Check bank balance | Balance fix, no bucket touched |

## Daily use

- **Log a spend:** click `+` on a bucket, or **Add expense**.
- **Salary day:** add the credit as **Received**, then **Divide salary** on Home.
- **Overspent a bucket:** **Move money** from another bucket to cover it.
- **Paid rent / EMI / SIP:** use **Invested** for SIP/FD, **Spent** for rent/EMI.
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
- **Settings → Backup** downloads a copy.
- The UI has no login because it binds to `127.0.0.1` only. Do not expose this server directly to the internet. For remote access, use a VPN such as Tailscale.
- The ingest token is the only write credential. Rotate it in Settings if it leaks.
- Never scrape your bank's website or store bank passwords. If you later connect a real bank API, use a licensed aggregator (RBI Account Aggregator in India, Plaid/TrueLayer elsewhere) with read-only consent.

## Development

```bash
npm test        # money-engine tests: division, leftovers, max, undo, balance checks, invariants
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
