# Tech Genius Software

Repair-shop software for Tech Genius: repair tickets, customers, invoices and automatic texts. Built to replace RepairDesk and, later, to sell to other shops.

## Day One features
- Sign-in for staff (owner, manager, technician, front desk)
- Search customers by phone, name, email or ticket number (`T-1001`)
- New repair ticket in one screen, with optional check-in text
- Ticket board by status; "Ready for pickup" texts the customer automatically
- Notes and full history on every ticket
- Invoices with 13% HST, discounts, deposits, split payments; void (owner/manager only)
- Printable invoice with logo, HST number and warranty terms; ticket labels for the Brother QL-800

## Stack
Next.js 15 · Supabase (Postgres + Auth, Canada region) · Tailwind CSS · Twilio (texts) · Vercel (hosting)

## Database setup (Supabase → SQL Editor, in this order)
1. `db/schema.sql`
2. `db/seed_techgenius.sql`
3. `db/002_app_functions.sql`
4. `db/003_import_customers.sql` (step A, upload CSV, then step B)
5. `db/004_add_staff.sql` (once per staff member)

## Environment variables (Vercel)
See `.env.example`.

## Folders
- `app/` screens · `components/` shared pieces · `lib/` helpers
- `db/` database scripts · `import/` RepairDesk import tool · `public/brand/` logo
- `docs/PLAN.md` full product plan and owner decisions · `CLAUDE.md` working notes for Claude Code

Customer exports and cleaned files never go into git (see `.gitignore`).
