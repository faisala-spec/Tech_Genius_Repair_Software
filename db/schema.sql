-- Tech Genius Software — Day One database schema (PostgreSQL / Supabase)
-- Every business table carries shop_id. Row-level security (bottom of file)
-- makes the database itself refuse to show one shop's rows to another shop.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;   -- fast "contains" search on names/phones

-- ───────────────────────── Shops & staff ─────────────────────────
create table shops (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  legal_name    text,
  phone         text,
  email         text,
  address       text,
  city          text,
  province      text default 'ON',
  country       text default 'CA',
  timezone      text default 'America/Toronto',
  currency      text default 'CAD',
  tax_name      text default 'HST',
  tax_rate      numeric(5,4) default 0.13,
  tax_number    text,                         -- HST registration number shown on invoices
  logo_url      text,
  brand_color   text default '#E28E34',            -- Tech Genius orange, from the logo
  ticket_prefix text default 'T-',
  invoice_terms text,                         -- warranty terms printed on every invoice
  repair_warranty_days int default 60,
  device_warranty_days int default 90,
  sms_number    text,                         -- Twilio number for this shop
  ai_call_start time default '10:00',
  ai_call_end   time default '19:00',
  review_link   text,                         -- Google review URL
  review_delay_minutes int default 60,
  next_ticket_number  int not null default 1000,
  next_invoice_number int not null default 1000,
  created_at    timestamptz default now()
);

create type staff_role as enum ('owner','manager','technician','front_desk');

create table staff (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references shops(id) on delete cascade,
  auth_user_id uuid unique,                   -- Supabase auth user
  full_name   text not null,
  email       text,
  role        staff_role not null,
  pin_hash    text,                           -- counter PIN, hashed (never stored plain)
  pay_per_repair_pct numeric(5,2),            -- technician pay, % of labour
  active      boolean default true,
  created_at  timestamptz default now()
);

-- ───────────────────────── Customers ─────────────────────────
create table customers (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shops(id) on delete cascade,
  legacy_code   text,                         -- RepairDesk customer code, kept for search
  first_name    text,
  last_name     text,
  company       text,
  phone         text,                         -- E.164, e.g. +19054845200
  phone_alt     text,
  email         text,
  address       text,
  city          text,
  province      text,
  postal_code   text,
  country       text,
  referral_source text,
  notes         text,
  sms_consent   boolean default true,         -- transactional texts about their repairs
  marketing_consent boolean default false,    -- separate opt-in (CASL)
  archived      boolean default false,
  legacy_ticket_count int default 0,
  legacy_lifetime_spend numeric(12,2) default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index customers_phone_idx  on customers(shop_id, phone);
create index customers_legacy_idx on customers(shop_id, legacy_code);
create index customers_name_trgm  on customers using gin ((coalesce(first_name,'')||' '||coalesce(last_name,'')||' '||coalesce(company,'')) gin_trgm_ops);

-- ───────────────────────── Repair tickets ─────────────────────────
create type ticket_status as enum (
  'received','diagnosing','awaiting_approval','awaiting_parts',
  'in_repair','ready','picked_up','cancelled'
);

create table tickets (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shops(id) on delete cascade,
  number        int not null,                 -- what staff and customers see
  legacy_number text,                         -- RepairDesk ticket number
  customer_id   uuid not null references customers(id),
  device_type   text not null,                -- phone, laptop, tablet, console, drone, printer, other
  brand         text,
  model         text,
  imei_serial   text,
  color         text,
  problem       text not null,
  condition_notes text,
  passcode_enc  bytea,                        -- encrypted; wiped at pickup
  accessories   text,                         -- charger, case, SIM…
  estimate      numeric(10,2),
  deposit       numeric(10,2) default 0,
  status        ticket_status not null default 'received',
  technician_id uuid references staff(id),
  created_by    uuid references staff(id),
  due_at        timestamptz,
  signature_url text,
  warranty_until date,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  picked_up_at  timestamptz,
  unique (shop_id, number)
);
create index tickets_status_idx   on tickets(shop_id, status);
create index tickets_customer_idx on tickets(customer_id);
create index tickets_imei_idx     on tickets(shop_id, imei_serial);

create table ticket_photos (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references shops(id) on delete cascade,
  ticket_id  uuid not null references tickets(id) on delete cascade,
  url        text not null,
  created_at timestamptz default now()
);

-- Every status change and note: the ticket's timeline
create table ticket_events (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references shops(id) on delete cascade,
  ticket_id  uuid not null references tickets(id) on delete cascade,
  kind       text not null,                   -- status_change, note, sms_sent, call, quote, voice_note
  from_status ticket_status,
  to_status   ticket_status,
  body       text,
  staff_id   uuid references staff(id),
  created_at timestamptz default now()
);

-- ───────────────────────── Products & stock ─────────────────────────
create table products (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shops(id) on delete cascade,
  legacy_id     text,
  name          text not null,
  category      text,                         -- part, accessory, device, service, subscription
  sku           text,
  barcode       text,
  cost          numeric(10,2) default 0,
  price         numeric(10,2) default 0,
  taxable       boolean default true,
  serialized    boolean default false,        -- phones/laptops tracked one by one
  qty_on_hand   int default 0,
  reorder_level int,
  supplier      text,
  warranty_days int,
  active        boolean default true,
  created_at    timestamptz default now()
);

create table stock_moves (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references shops(id) on delete cascade,
  product_id uuid not null references products(id),
  qty        int not null,                    -- + received, − sold/used
  reason     text not null,                   -- sale, repair_use, receive, count, return
  ref_id     uuid,                            -- invoice or ticket
  unit_cost  numeric(10,2),
  created_at timestamptz default now()
);

-- ───────────────────────── Invoices & payments ─────────────────────────
create type invoice_status as enum ('draft','unpaid','partial','paid','void');

create table invoices (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references shops(id) on delete cascade,
  number      int not null,
  customer_id uuid references customers(id),
  ticket_id   uuid references tickets(id),
  status      invoice_status not null default 'unpaid',
  subtotal    numeric(12,2) not null default 0,
  discount    numeric(12,2) not null default 0,
  tax         numeric(12,2) not null default 0,
  total       numeric(12,2) not null default 0,
  paid        numeric(12,2) not null default 0,
  notes       text,
  created_by  uuid references staff(id),
  created_at  timestamptz default now(),
  voided_at   timestamptz,                    -- invoices are voided, never deleted
  unique (shop_id, number)
);

create table invoice_items (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references shops(id) on delete cascade,
  invoice_id  uuid not null references invoices(id) on delete cascade,
  product_id  uuid references products(id),
  description text not null,
  imei_serial text,
  qty         numeric(10,2) not null default 1,
  unit_price  numeric(10,2) not null,
  unit_cost   numeric(10,2) default 0,        -- for true profit per sale/repair
  discount    numeric(10,2) default 0,
  taxable     boolean default true,
  line_total  numeric(12,2) not null
);

create type payment_method as enum ('cash','debit','credit','etransfer','store_credit','other');

create table payments (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references shops(id) on delete cascade,
  invoice_id  uuid not null references invoices(id),
  method      payment_method not null,
  amount      numeric(12,2) not null,         -- negative = refund
  reference   text,                           -- Moneris auth / last 4 digits only, never full card
  staff_id    uuid references staff(id),
  created_at  timestamptz default now()
);

-- ───────────────────────── Messages (texts & calls) ─────────────────────────
create table messages (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references shops(id) on delete cascade,
  customer_id uuid references customers(id),
  ticket_id   uuid references tickets(id),
  channel     text not null,                  -- sms, voice
  direction   text not null,                  -- out, in
  body        text,
  status      text,                           -- queued, sent, delivered, failed
  provider_id text,
  sent_by     text,                           -- staff id or 'ai'
  created_at  timestamptz default now()
);

-- ───────────────────────── Audit log ─────────────────────────
create table audit_log (
  id         bigserial primary key,
  shop_id    uuid not null,
  staff_id   uuid,
  action     text not null,                   -- view_passcode, refund, void_invoice, price_change…
  entity     text,
  entity_id  uuid,
  detail     jsonb,
  created_at timestamptz default now()
);

-- ───────────────────────── Shop isolation (RLS) ─────────────────────────
-- A signed-in staff member can only touch rows of their own shop.
create or replace function current_shop_id() returns uuid
language sql stable security definer set search_path = public as $$
  select shop_id from staff where auth_user_id = auth.uid() and active
$$;

do $$
declare t text;
begin
  foreach t in array array['staff','customers','tickets','ticket_photos','ticket_events',
                           'products','stock_moves','invoices','invoice_items','payments',
                           'messages','audit_log']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy shop_isolation on %I using (shop_id = current_shop_id()) with check (shop_id = current_shop_id())', t);
  end loop;
end $$;

alter table shops enable row level security;
create policy own_shop on shops using (id = current_shop_id());
