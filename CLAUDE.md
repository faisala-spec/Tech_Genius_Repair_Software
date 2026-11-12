# Tech Genius Software: instructions for Claude

You are the developer building this with the owner, Faisal Ahmed (Tech Genius, Burlington, Ontario). He is not a full-time developer; a developer of his drops in now and then. Explain things in plain words, keep answers short, and show him the result (a running screen, a link) rather than a description of effort.

Read `docs/PLAN.md` for the full product plan and every answer the owner gave. This file is the short version plus the rules.

## What this is
Repair-shop software for Tech Genius (cell phones, laptops, tablets, consoles, drones, printers — any repairable electronics; also buys/sells/trades devices). It replaces RepairDesk ($150 + tax/month, too many clicks and tabs). After it works in this store it becomes a SaaS sold to other repair shops, Canada first, US later.

Goals in the owner's words: very simple, nice, interactive; everything in one place; accounting and inventory matter a lot; repair tickets with full customer info; AI texts and AI voice follow-up so staff don't call customers manually; very secure, no data leaks; monthly running costs must be cheap.

## Hard deadline
**Cancel RepairDesk on Nov 27, 2026.** Day One version must be live and used in the store before then. Plan:
- Nov 13–19 build and polish Day One screens
- Nov 20–22 import real customers, check counts
- Nov 23–26 run side by side with RepairDesk, staff use it for real tickets
- Nov 27 switch over
If Day One isn't solid by Nov 26, tell the owner plainly: one more month of RepairDesk is cheaper than losing data.

## Decisions already made (don't re-ask)
- **Tickets and invoices start fresh** at `T-1001` and invoice `1001`. Old RepairDesk tickets/invoices are NOT migrated (export isn't possible). Customers ARE migrated.
- Brand: Tech Genius orange `#E28E34` (taken from logo), logo at `public/brand/techgenius-logo.png` (only 180 px; ask for the original file). Look at techgenius.ca / univercell.ca for colour feel.
- Shop: Tech Genius Burlington Inc., 796 Brant Street Unit 3, Burlington ON, +1 905-333-3345, info@techgenius.ca, HST # 741942122RT0001, 13% HST. Warranty terms are in `db/seed_techgenius.sql`.
- Roles: owner, manager, technician, front_desk. One store now.
- Warranty: 60 days repairs, 60–90 days on phones sold.
- Payments: Moneris terminal (standalone for now; record method in the app). Never store card numbers.
- Printers: Brother QL-800 labels (62 mm), normal Brother MFC for invoices. Desktop at the counter, must also work on phones.
- Texts/calls: English only; tone friendly-casual but a bit professional; AI calls only 10 am–7 pm; outgoing calls only for now (inbound later, keep the option open); Google review text ~1 hour after pickup.
- Buybacks: ID required for iPhone 16 and up, IMEI + contact details for lower models. They want a built-in blacklist/IMEI check (they currently look things up on sigw.com and similar). Buyback prices: their own trading website + GoRecell.ca for reference.
- Accounting: accountant uses bank statements, no QuickBooks. Currently no tracking of rent/payroll; supplies tracked. Want cash tracking and **technician pay per repair**.
- Parts suppliers: MobileSentrix mainly, plus others.
- Online booking: add it, low priority.
- Not connected to the owner's separate online trading platform. Keep them separate for now.
- **Owner's own feature request:** a "talk to update" button — tech or front desk taps, speaks, and AI changes the ticket status, writes notes, or drafts a quote. Do this right after Day One.

## Current state (as of Nov 11, 2026)
Built and pushed. Nov 11: `npm install`, `npm run build` (type checking ON, zero errors) and `npm run dev` all work; login screen loads at http://localhost:3000/login. Every screen clicked through in Edge (desktop + phone size) with a test ticket: check-in, status, notes, ready text, pickup + warranty, invoice + payment, print invoice/label, customer search/edit/new. Fixed: board overflow, deposit taken from DB (once per ticket), balance-after-tax in ready text, Toronto dates for warranty, "credit owed" instead of negative balance.
- `app/` Next.js 15 App Router screens: login, home dashboard, tickets (board + list + new + detail with status buttons, notes, texting), customers (search by phone/name/email/ticket #, detail, new, edit), invoices (builder with HST/discount/deposit/payments, detail, void for owner/manager), print pages (`/print/invoice/[id]`, `/print/label/[id]`).
- `lib/` Supabase server client, session/role helpers, formatting, Twilio sender (texts no-op until env vars exist).
- `db/` SQL: `schema.sql`, `seed_techgenius.sql`, `002_app_functions.sql`, `003_import_customers.sql`, `004_add_staff.sql`. Tested on Postgres 16: runs clean, imports 9,276 customers, numbering starts at 1001, RLS hides all rows from a non-staff user.
- `import/import_repairdesk.py` cleans RepairDesk exports. Output files contain customer PII and are git-ignored; the owner has `customers_clean.csv`.
- `next.config.mjs`: type checking is on; ESLint skipped until it's added. `npm audit` flags PostCSS inside Next 15 (build-time only); the fix needs Next 16, do it after Nov 27.

Not done yet:
- **Supabase**: owner chose Canada. New project "Tech Genius Software (Canada)" (ref `dsqnmdeersmkjojnwcij`, ca-central-1) created Nov 11. Set up Nov 11: SQL files 001–002 + `005_security_fixes.sql` applied, 9,276 customers imported (253 archived, 413 no phone, matches the file), owner login `info@techgenius.ca` (staff role owner, temporary password given to the owner in chat; must change it). Import was done signed in as the owner via supabase-js, RLS on. Still to do by the owner in the dashboard: turn OFF "Allow new users to sign up" (no API for it); delete the old US project `bnwobsaishumqwrodifx` (paused Nov 11; MCP can't delete projects). Test records removed by the owner Nov 12; DB is clean: 9,276 customers, 0 tickets/invoices, next numbers 1001/1001.vercel.app (project `prj_eozmBUtEpNFwLQEyDhaBy0Ulo3LM`, team `team_R6AKRdSSAltqTKMIklA2gNH9`, functions in `yul1` Montreal, env vars set). GitHub-linked: every push to `main` deploys. Login + dashboard + search tested live Nov 12.
- Nov 12 added: `/account` (change password; checks current password first), fast check-in (`components/CheckInForm.tsx`: live customer search, past-device chips, tap chips for type/brand/problem, auto-print label), label printing via hidden same-site iframe (`components/PrintLabelButton.tsx`; `X-Frame-Options` is SAMEORIGIN for this), `docs/PRINTING.md` QL-800 setup. Ask the owner which 62 mm roll they use (label is 62 × 29 mm, fits DK-1209 and DK-2205).
- Twilio account/number not set up.

## Next steps, in order
1. ~~`npm install`, `npm run build`, `npm run dev`. Fix every error. Click through every screen.~~ Done Nov 11.
2. Settle the Supabase region, set up the database, import customers, create the owner login.
3. ~~Vercel env vars, deploy~~ done Nov 12; owner to test on the counter desktop.
4. Polish Day One (speed of check-in, printing on the QL-800, mobile layout). Check-in + label printing done Nov 12; still to test on the real QL-800 in the store.
5. Twilio texting (Canadian number), then the talk-to-update button.
6. After Nov 27: buybacks + IMEI check, inventory + MobileSentrix, accounting (cash, expenses, tech pay), AI voice calls, review requests, online booking, then multi-shop SaaS (sign-up, Stripe billing, RepairDesk importer for other shops).

## Data notes (from the RepairDesk export)
- 9,276 customers (owner said 10,000+; ask if the export was complete). 253 marked "DELETE 1" → imported as archived. 402 have no phone. 193 phone numbers are shared by several customers (family or duplicates, owner to decide). Device MAC addresses had been typed into the address field; moved to notes.
- RepairDesk showed ~$303k of "receivables" across 53 customers, mostly two business accounts. NOT imported as balances until the owner confirms.
- Products export had only 31 items with mostly negative stock and $0 cost. Plan: fresh stock count instead of importing.
- The owner has a review spreadsheet of these items.

## Rules
- Security first: every table has `shop_id` + RLS; never bypass RLS in app code; never put secrets or customer data in git; never log card numbers, passcodes or ID numbers. Passcodes get wiped at pickup.
- Keep the UI simple: five main areas (Home, Tickets, Customers, Invoices, later Inventory/Money). Fewer clicks than RepairDesk is the bar.
- Money: totals are always computed on the server; invoices are voided, never deleted.
- Canada: CAD, America/Toronto time, 13% HST default, CASL consent for texts (transactional vs marketing opt-in kept separate).
- Keep monthly costs low; prefer pay-as-you-go services.
- Commit in small steps with clear messages; push to `main` only when it builds.
