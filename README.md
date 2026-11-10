# Tech Genius Software

Repair-shop software for Tech Genius (tickets, invoices, inventory, AI follow-up), built to replace RepairDesk and later sold to other shops.

- `db/schema.sql` — PostgreSQL/Supabase schema with per-shop row-level security
- `import/import_repairdesk.py` — cleans RepairDesk exports into import-ready files and a review list

Customer exports and cleaned files stay out of git (see `.gitignore`).
- `db/seed_techgenius.sql` — Tech Genius shop record: logo, orange #E28E34, HST number, invoice terms; tickets start fresh at T-1001, invoices at 1001
- `public/brand/techgenius-logo.png` — logo taken from a RepairDesk invoice (180 px; replace with the original file when available)
