# How the books work

Written for the owner, the accountant, and any developer. The code that does all this is in `db/007`–`db/010`. The tests that prove it are in `test/db/` and run with `npm test`.

## The promise
- **Every dollar is recorded twice** (double-entry), and both sides always match. The database refuses to save an entry that doesn't balance.
- **Nothing is ever edited or deleted.** A mistake is fixed with a new entry that reverses it, so the history always shows what happened. This holds even for an administrator.
- **Money is stored in whole cents.** There are no decimals in calculations, so nothing gets lost to rounding.
- **The browser never sends totals.** The database works out tax, discounts, balances and statuses itself.
- **Staff can't change money records directly.** Every money action goes through one checked database function. Each function checks the person's role and either finishes completely or not at all.
- **Finished months can be locked.** Nothing can be posted into a locked month. Unlocking needs the owner and a written reason, and is recorded.

## Who can do what
| | Owner | Manager | Front desk | Technician |
|---|---|---|---|---|
| Tickets, customers | ✓ | ✓ | ✓ | ✓ |
| Take a deposit, open/close the drawer | ✓ | ✓ | ✓ | ✓ |
| Invoices and payments | ✓ | ✓ | ✓ | – |
| See part costs on invoices | ✓ | ✓ | – | – |
| Credit notes, refunds, voids, deposit refunds | ✓ | ✓ | – | – |
| Expenses, bank drops, owner draws | ✓ | ✓ | – | – |
| Reports, ledger, expected cash in the drawer | ✓ | ✓ | – | – |
| Lock or unlock the books, staff, shop settings | ✓ | – | – | – |

Front desk counts the drawer "blind": they don't see the expected amount.

## Chart of accounts
| Code | Account | What goes in it |
|---|---|---|
| 1000 | Cash drawer | Cash payments, cash refunds, cash expenses, drops |
| 1020 | Bank account | e-Transfers, bank-paid expenses, cash dropped at the bank |
| 1050 | Card payments (Moneris) | Debit and credit card payments until Moneris deposits them |
| 1100 | Customers owe us (A/R) | Unpaid invoice balances |
| 2100 | Business credit card | Expenses put on the business card |
| 2200 | HST collected | 13% charged to customers |
| 2210 | HST paid on expenses (ITCs) | 13% paid to suppliers that we claim back |
| 2300 | Customer deposits | Money taken at check-in before there's an invoice |
| 3000 / 3100 | Owner contributions / draws | Starting float, owner paying personally, owner taking cash |
| 4000–4030 | Sales: Repairs, Devices, Accessories, Other | Before tax, at full price |
| 4900 | Discounts given | Shown as a minus on sales |
| 5000 | Parts & supplies for repairs | Parts purchases |
| 5020 | Outsourced repairs | Paying another shop; linked to the ticket |
| 6000–6190 | Expenses | Rent, wages, supplies, utilities, software, ads, card fees, bank fees, insurance, maintenance, shipping, professional fees, other. The owner can add more. |
| 6900 | Cash over/short | Difference between the counted drawer and the expected amount |
| 6910 | Cash rounding | No pennies: cash rounds to the nearest 5¢ |

## What each action records
| Action | Debit (goes up / we get) | Credit (where it came from) |
|---|---|---|
| Deposit at check-in | Cash / card / bank | Customer deposits |
| Invoice | A/R (total), Discounts | Sales by category (full price), HST collected |
| Deposit used on the invoice | Customer deposits | A/R |
| Payment | Cash / card / bank | A/R (cash: ± rounding to 6910) |
| Credit note | Sales, HST collected | Discounts, A/R |
| Refund | A/R | Cash / card / bank |
| Void (unpaid invoices only) | Exact mirror of the invoice, dated today | |
| Expense | Expense category (net), HST ITCs (if claimed) | Cash / bank / business card / owner |
| Drawer count difference | Cash or Over/short | Over/short or Cash. The very first count is the owner's float, posted to 3000. |
| Bank drop / owner draw | Bank / Owner draws | Cash |

## Rules worth knowing
- **HST (Regular method).**
  - HST is worked out once per invoice on the total after discount, rounded to the nearest cent. It is then split back onto the lines so credit notes can reverse it exactly.
  - Claiming back HST paid is allowed only on categories where CRA allows it. Wages, card fees, bank fees and insurance are blocked.
  - The HST report flags any claims without a receipt.
- **Parts cost.**
  - Parts purchases are expenses (5000).
  - The "part cost" typed on an invoice line is used only for the profit-per-repair report. It is not posted, so nothing is counted twice.
  - When the inventory module arrives, this switches to stock-based costing.
- **Technicians** are paid hourly, recorded as wages. There is no per-repair commission.
- **Deposits** are the customer's money until there's an invoice. They're applied once, and any leftover stays on the ticket until refunded.
- **Credit notes.**
  - A credit can't exceed what's on the invoice, and part-credits never drift.
  - A refund is required when the customer has paid more than they now owe. It can never exceed what they paid.
- **Voiding.** Only an invoice nobody has paid can be voided, and only if its month isn't locked. Otherwise use a credit note.
- **Cash.**
  - Payments in 5¢ steps.
  - Paying the balance rounded to the nickel settles the invoice exactly.
  - Cash actions need the drawer to be open.

## Reports
All reports read only the journal, by the shop's local (Toronto) date.
- **P&L** (`report_pnl`)
- **Balance sheet** (`report_balance_sheet`). Assets always equal liabilities plus equity.
- **HST return**, lines 101–109 (`report_hst`)
- **Unpaid invoices by age** (`report_ar_aging`). Its total always equals the A/R account.
- **Payments by method** (`report_payments`)
- **Cash drawer days** (`report_cash`)
- **Expenses** (`report_expenses`)
- **Profit per repair** (`report_ticket_profit`)
- **Home page numbers** (`dashboard_money`)

## How it's tested
`npm test` builds a fresh database from `db/*.sql` and acts as real staff in every role. After every money test it checks that the books add up. Each check compares two independent sources:
- every entry balances
- invoice math is exact
- what each invoice is owed matches the ledger
- A/R matches the open invoices
- deposits are never negative
- HST collected matches the invoices and credit notes
- HST claimed back matches the expense receipts
- cash, card and bank match the payment, expense and drawer records

It also runs random sequences of real-world actions, and works through a full day of business by hand against every report.

## Not built yet
- Bank statement matching
- Moneris settlement and fee entries (until then, record card fees as an expense)
- HST filing entry
- Store credit
- Stock-based parts costing
- Buybacks
- Read-only accountant login

**Questions for the accountant:**
- HST filing period
- Opening balances at go-live (bank, cash, anything owed)
