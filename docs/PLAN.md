# Tech Genius Software: build plan

Planned with the owner on Nov 10–11, 2026. The live copy of this plan is the "Repair Shop SaaS — Build Plan" doc in the owner's claude.ai project; this file is the copy that travels with the code.

## 1. Vision: how we beat RepairDesk
One simple, fast system for phone and laptop shops: tickets, sales, buybacks, inventory and accounting in one place, with an AI assistant that texts and calls customers so staff never have to. Run it in Tech Genius first, then sell it to other shops as a monthly subscription.

1. **Five screens, not fifty.** Home, Tickets, Sell, Inventory, Money. Everything else in Settings.
2. **60-second check-in.** Type a phone number, pick the device, tap the problem, get a signature.
3. **AI built in, not bolted on.** Texts, follow-ups, voice calls and quote approvals run from the ticket status.
4. **Accounting that is actually right.** Every sale, refund, buyback and part used posts to a real ledger.
5. **Easy to switch.** One-click import from a RepairDesk export.

## 2. Day One (live by Nov 27, 2026)
| Feature | Detail |
| --- | --- |
| Import from RepairDesk | All customers (9,276), checked count by count |
| Search | Phone number or ticket number from one search box |
| Repair tickets | Any device type, created in under a minute |
| Status board | Received → Diagnosing → Waiting for approval → Waiting for parts → In repair → Ready → Picked up; automatic "ready for pickup" text |
| Invoices and payments | 13% HST, card/cash recorded; Moneris terminal stays standalone |
| Printing | Ticket labels on Brother QL-800, invoices on Brother MFC |
| Staff logins | Owner, manager, tech, front desk |
| Devices | Desktop at the counter, also works on a phone |
| Look | Orange, simple, Tech Genius logo |

Tickets and invoices start fresh at T-1001 / 1001. Old tickets are not migrated.

## 3. Right after Day One
- **Talk-to-update button** (owner's request): tap, speak, AI changes status, writes notes or drafts a quote.
- Buybacks: ID for iPhone 16 and up, IMEI + contact for lower models, built-in blacklist/IMEI check, price lookup (own trading site, GoRecell.ca).
- Accounting with cash tracking, expenses, technician pay per repair, reports the accountant can use with bank statements.
- Inventory and parts ordering, MobileSentrix first.
- AI voice calls (outgoing, 10 am–7 pm), Google review text 1 hour after pickup, online repair booking.
- Warranty tracking: 60 days repairs, 60–90 days phones.

## 4. Core modules (full product)
| Module | What it does |
| --- | --- |
| Customers | One profile per customer, found by phone; full history of repairs, purchases, buybacks, texts and calls; consent recorded |
| Repair tickets | Device, IMEI/serial, problem, condition checklist, photos, passcode (encrypted, deleted at pickup), estimate, deposit, e-signature, warranty, technician, notes |
| Point of sale | Phones, accessories, repairs; barcode scanning, discounts, split payments, deposits, refunds, store credit, cash drawer open/close |
| Invoices and estimates | Branded PDF by text or email; customer approves estimate from their phone |
| Buybacks and trade-ins | IMEI check, grading A/B/C, seller ID capture, payout, device goes into stock |
| Customer portal | Live repair status, approve quote, pay online, invoice and warranty |

## 5. AI customer follow-up
| When | What the AI does | Channel |
| --- | --- | --- |
| Ticket created | Confirmation with ticket number and status link | Text |
| Needs approval | Sends quote; customer replies YES or taps Approve | Text, then call if no reply in 4 h |
| Waiting for parts | Realistic date, update if it changes | Text |
| Repair ready | Ready for pickup, balance due | Text |
| Not picked up | Reminder at 24 h, AI voice call at 48 h | Text, voice |
| 3 days after pickup | "Is everything working?" Problems open a warranty ticket | Text or voice |
| ~1 hour after pickup | Google review request | Text |

Two-way shared inbox with AI-suggested replies. Inbound AI answering later (kept open as an option). Guardrails: the voice agent says it is AI; calls 10 am–7 pm only; weekly call limit per customer; recordings + transcripts on the ticket; text consent at check-in, separate marketing opt-in, STOP always works; confirm CASL/telemarketing rules with a lawyer before launch.

Tools: Twilio (texts, numbers), Retell or Vapi (voice), Claude API (writing and understanding messages).

## 6. Accounting
Double-entry ledger underneath, plain answers on screen.
- Automatic posting of sales, refunds, deposits, buybacks, parts used, bills, expenses
- True profit per repair (price − parts − labour)
- HST collected vs paid, filing-period summary
- Cash control: opening float, end-of-day count, over/short per staff
- Expenses and bills by receipt photo (AI reads it)
- Bank matching with statements
- Reports: P&L, sales by category/staff, tax, inventory value, unpaid invoices, buyback spend
- Read-only accountant login; exports
- Used-device purchase tax rules to be set up with the accountant

## 7. Inventory
- Parts/accessories by quantity; phones/laptops one by one by IMEI/serial (model, storage, colour, grade, battery health, cost, source)
- Parts used on a ticket come out of stock and cost the repair
- Low-stock alerts, purchase orders, receive by barcode, stock counts, multi-location transfers
- Full device history; stock value and slow-mover reports
- Start with a fresh stock count (RepairDesk stock data is unreliable)

## 8. Security
- Each shop sealed off by database row-level security
- HTTPS everywhere, encryption at rest, extra encryption for passcodes and seller IDs
- Passcodes deleted at pickup; ID photos kept only as long as by-laws require
- No card numbers stored (Moneris/Stripe terminals)
- Role permissions; techs don't see accounting; front desk can't delete invoices or change prices without approval
- 2FA for owner/manager, PIN switching at the counter, idle logout
- Audit log; financial records voided, never deleted
- Daily backups, tested restores
- Canadian hosting (ca-central-1) for PIPEDA
- Outside penetration test before selling to other shops; SOC 2 later

## 9. SaaS model
| Plan | For | Includes |
| --- | --- | --- |
| Starter | 1 store, up to 3 staff | Tickets, POS, inventory, invoices, automatic texts |
| Pro | 1 store, unlimited staff | + accounting, AI inbox, AI voice, customer portal |
| Multi-store | 2+ locations | + stock transfers, combined reports, central admin |

Texts and voice minutes billed by usage. Prices set after measuring Tech Genius's own SMS/voice costs. Needs: online sign-up with trial, Stripe Billing, guided setup, RepairDesk importer, help centre, super-admin console. Canada first, US later.

## 10. Tech stack
Next.js + TypeScript + Tailwind · Supabase Postgres with RLS + Auth · encrypted file storage in Canada · Moneris / Stripe Terminal · Stripe Billing · Twilio · Retell or Vapi · Claude API · Vercel + Supabase in Canada · browser printing + Brother QL-800 labels. One well-organised app, not microservices.

## 11. Owner's answers (Nov 10, 2026)
1. RepairDesk pain: complicated interface, too many tabs and clicks to create a ticket; expensive ($150 + tax/month); no cash accounting; hard to understand. They only use it for repairs (trade-ins are unclear there). Must keep: search by phone number and ticket number; all customer data (10,000+ expected) must come across.
2. Not connected to the owner's trading platform; keep separate. Capture seller info for devices bought.
3. Building side by side with Claude; a developer helps sometimes. Has GitHub, domain and a budget, but monthly costs must be cheap.
4. Canada first, keep US open.
5. One store; roles owner, manager, tech, front desk.
6. Stop RepairDesk by Nov 27.
7. Moneris.
8. Brother QL-800 labels; normal Brother MFC printer for receipts.
9. Repairs all kinds of electronics incl. drones and printers.
10. MobileSentrix primary, other suppliers too.
11. Warranty 60 days repairs, 60–90 days phones.
12. ID for iPhone 16 and up; IMEI + customer info for lower models.
13. No blacklist check today; wants one built in.
14. Prices from own trading website + GoRecell.ca.
15. Accountant uses bank statements, no QuickBooks.
16. Registered for HST, Ontario tax.
17. Supplies tracked; rent and payroll not.
18. Technician pay per repair: yes.
19. English only.
20. Tone: friendly-casual, a bit professional.
21. AI calls 10 am–7 pm.
22. Outgoing calls only for now.
23. Google review request ~1 h after pickup.
24. Orange like univercell.ca / techgenius.ca; Tech Genius logo; better-looking than RepairDesk.
25. Desktop at the front, also phone.
26. Online booking: add it.
27. Customer export provided; tickets could not be exported.
