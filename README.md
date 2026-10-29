# Khaata

A local-first expense tracker built around envelopes. No bank login, no cloud, no build step. Your ledger is a JSON file on your own computer.

Khaata does **not** log into your bank. It keeps itself current from bank/UPI alerts you forward to its own ingest endpoint (see below), or from manual entries. That keeps it legal, private, and independent of any one bank's API.

Built for one person with one salary: fixed commitments get funded first, the rest is split by percentage, and sinking funds roll over with a cap.

## Run it

Requires Node 20 or newer.

```bash
npm start
```

Open **http://127.0.0.1:4321**.

There are no dependencies to install.

## First run

Enter two numbers:

1. **Monthly take-home** — what actually reaches your bank.
2. **Current bank balance** — what is in the account right now.

If the balance is enough to fund the whole month, the app allocates immediately. If salary hasn't landed yet, it leaves the money unallocated and tells you; add the salary as income and allocate once it arrives.

The seeded plan is a template for ₹1,00,000. Edit every amount in **Plan** before trusting it: your rent, EMI and SIP are yours, not the defaults.

## The model

- **Commitments** (rent, loan EMI, SIP, emergency) are fixed rupee amounts, funded first.
- **Everyday envelopes** (groceries, transport, clothes, electronics, fun, misc) split whatever is left by percentage.
- **Everyday percentages must add up to 100%.**
- **Rollover** envelopes keep their leftover next month. A cap stops them growing forever. Groceries and fun reset instead.
- **One allocation per calendar month.** It fills each envelope to its target from the unallocated bank balance. Extra money is swept to the surplus envelope (Emergency by default).
- **Undo is available until money moves.** Once you record spending or move money between envelopes, the allocation locks and you adjust envelopes instead. Re-running always happens from a real, current balance.
- **The bank balance never changes when you allocate or move money.** Allocation is a labelling of money that is already there.
- Envelopes are virtual. The bank only knows one balance. Sum of envelopes + unallocated always equals the real bank balance.

### Why not split the current balance by percentage continuously?

Because then buying clothes quietly shrinks your rent and EMI capacity, and no envelope can ever reach zero. Percentages are an **allocation rule**, applied once per payday, not a live lens on the balance.

### What counts as what

| Action | Transaction type | Effect |
|---|---|---|
| Rent, groceries, clothes | Expense | Envelope goes down, counted as spending |
| Salary, interest | Income | Unallocated goes up |
| SIP, FD, broker transfer | Transfer | Envelope goes down, **not** counted as spending |
| Return / cashback | Refund | Money goes back into the envelope |
| Bank mismatch | Reconcile | Adjustment transaction, no envelope touched |

## Daily use

- **Log a spend:** click `+` on an envelope, or **Add expense**.
- **Salary day:** add the credit as **Income**, then **Allocate** on the overview.
- **Overspent an envelope:** **Move money** from another envelope to cover it.
- **Paid rent / EMI / SIP:** use **Transfer** for SIP/FD, **Expense** for rent/EMI.
- **Check against the bank:** **Reconcile** whenever you want. Differences are recorded explicitly.

## Automatic updates from bank / UPI alerts

The app has an ingest endpoint. Your phone can POST each alert to it; the app records the transaction, guesses the envelope, and optionally reconciles to the balance in the alert.

Useful fields:

| Field | Required | Notes |
|---|---|---|
| `amount` | yes | In **rupees**, e.g. `450.50` (₹ and commas are tolerated) |
| `direction` | yes | `"out"` or `"in"` |
| `description` | yes | Merchant / narration |
| `balance` | no | Available balance from the alert, in rupees. Reconciles automatically. |
| `date` | no | `YYYY-MM-DD`, defaults to today |
| `category` | no | Envelope name, e.g. `"Fun"` |
| `externalId` | no | Unique alert id. Sending the same id twice is ignored. |
| `kind` | no | `expense`, `income`, `transfer`; defaults from direction |

```bash
curl -s -X POST http://127.0.0.1:4321/api/ingest \
  -H 'content-type: application/json' \
  -H 'x-ingest-token: YOUR_TOKEN' \
  -d '{"amount":450.50,"direction":"out","description":"Swiggy","balance":52187.50,"externalId":"sms-9182"}'
```

The token and a copy-ready curl snippet are in **Settings → Automatic updates**.

- **iPhone:** Shortcuts → Automation → SMS/email from your bank → Get Contents of URL → POST JSON. iOS cannot read other apps' notifications.
- **Android:** Tasker or MacroDroid → notification from your bank/UPI app → HTTP POST. This is the closest to instant.
- To reach the server from your phone, run `HOST=0.0.0.0 npm start` and use your Mac's LAN IP. Keep the token private; it can write to the ledger.

Reconciliation is what keeps this honest: alerts can be missed, duplicated or delayed. One real balance check a day corrects everything.

## Data and security

- Ledger: `data/store.json`; previous version: `data/store.json.bak`.
- **Settings → Backup** downloads a copy.
- The UI has no login because it binds to `127.0.0.1` only. Do not expose this server directly to the internet. For remote access, use a VPN such as Tailscale.
- The ingest token is the only write credential. Rotate it in Settings if it leaks.
- Never scrape your bank's website or store bank passwords. If you later connect a real bank API, use a licensed aggregator (RBI Account Aggregator in India, Plaid/TrueLayer elsewhere) with read-only consent.

## Development

```bash
npm test        # money-engine tests: allocation, rollover, caps, undo, reconciliation, invariants
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
