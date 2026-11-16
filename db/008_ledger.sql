-- 008: double-entry ledger and every money action as one checked database function.
--
-- Rules this file enforces (tests: test/db/ledger.test.ts):
--  * Money is whole cents (bigint). No floats anywhere.
--  * Every money action writes a journal entry whose debits equal its credits, checked at commit.
--  * Journal rows can never be changed or deleted, by anyone. Mistakes are fixed by reversing entries.
--  * Nothing can be posted on or before the "books locked through" date.
--  * Staff can't write money tables directly; only the functions below can, after checking the role.
--  * The browser never sends totals: the database computes tax, discounts and balances.
-- Design notes and posting rules: docs/ACCOUNTING.md

-- ───────── Safety: only run on a shop with no money history yet ─────────
do $$ begin
  if exists (select 1 from invoices) or exists (select 1 from payments) or exists (select 1 from invoice_items) then
    raise exception '008_ledger must run before any invoices or payments exist';
  end if;
  if exists (select 1 from tickets where coalesce(deposit, 0) <> 0) then
    raise exception '008_ledger: tickets with deposits exist; record them through the ledger first';
  end if;
end $$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ───────── Rebuild the money tables in cents ─────────
drop table if exists payments, invoice_items, invoices cascade;
drop type if exists invoice_status, payment_method cascade;

alter table shops add column books_locked_through date;

alter table tickets add column estimate_cents bigint check (estimate_cents >= 0);
update tickets set estimate_cents = round(estimate * 100)::bigint where estimate is not null;
alter table tickets drop column estimate, drop column deposit;
grant update (estimate_cents) on tickets to authenticated;

-- Old helper: invoices now number themselves inside create_invoice().
create or replace function public.next_number(kind text) returns int
language plpgsql security definer set search_path = public as $$
declare n int; sid uuid := current_shop_id();
begin
  if sid is null then raise exception 'not signed in as staff'; end if;
  if kind = 'ticket' then
    update shops set next_ticket_number = next_ticket_number + 1 where id = sid returning next_ticket_number - 1 into n;
    return n;
  end if;
  raise exception 'next_number(%) is not available; invoices are numbered by create_invoice()', kind;
end $$;

-- ───────── Chart of accounts ─────────
create table accounts (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shops(id) on delete cascade,
  code          text not null,
  name          text not null,
  type          text not null check (type in ('asset', 'liability', 'equity', 'income', 'expense')),
  normal_side   char(1) not null check (normal_side in ('D', 'C')),
  system_key    text,                              -- how functions find an account; null for owner-added categories
  is_expense_category boolean not null default false,  -- appears in "Add expense"
  itc_allowed   boolean not null default true,     -- HST on this kind of expense can be claimed back
  active        boolean not null default true,
  sort          int not null default 0,
  unique (shop_id, code),
  unique (shop_id, system_key),
  unique (shop_id, id)
);

-- ───────── Journal ─────────
create table journal_entries (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references shops(id),
  entry_no          bigint generated always as identity,
  entry_date        date not null,                 -- the shop's local (Toronto) date
  posted_at         timestamptz not null default now(),
  source_type       text not null check (source_type in (
                      'invoice', 'invoice_void', 'payment', 'deposit', 'deposit_applied', 'deposit_unapplied',
                      'deposit_refund', 'refund', 'credit_note', 'expense', 'expense_void',
                      'cash_count', 'cash_movement')),
  source_id         uuid,
  memo              text,
  reverses_entry_id uuid references journal_entries(id),
  created_by        uuid references staff(id),
  unique (shop_id, id)
);
create index journal_entries_date_idx on journal_entries (shop_id, entry_date);

create table journal_lines (
  id            bigint generated always as identity primary key,
  shop_id       uuid not null,
  entry_id      uuid not null,
  line_no       smallint not null,
  account_id    uuid not null,
  debit_cents   bigint not null default 0 check (debit_cents >= 0),
  credit_cents  bigint not null default 0 check (credit_cents >= 0),
  customer_id   uuid,
  invoice_id    uuid,
  ticket_id     uuid,
  payment_id    uuid,
  expense_id    uuid,
  staff_id      uuid,
  memo          text,
  check ((debit_cents = 0) <> (credit_cents = 0)),   -- exactly one side, never both, never neither
  foreign key (shop_id, entry_id) references journal_entries (shop_id, id),
  foreign key (shop_id, account_id) references accounts (shop_id, id),
  unique (entry_id, line_no)
);
create index journal_lines_account_idx on journal_lines (shop_id, account_id);
create index journal_lines_invoice_idx on journal_lines (invoice_id) where invoice_id is not null;
create index journal_lines_ticket_idx on journal_lines (ticket_id) where ticket_id is not null;

-- Journal rows are permanent.
create trigger journal_entries_immutable before update or delete on journal_entries for each row execute function block_change();
create trigger journal_entries_no_truncate before truncate on journal_entries for each statement execute function block_change();
create trigger journal_lines_immutable before update or delete on journal_lines for each row execute function block_change();
create trigger journal_lines_no_truncate before truncate on journal_lines for each statement execute function block_change();

-- Every entry balances and has at least two lines, checked when the transaction commits.
create or replace function private.assert_entry_balanced(eid uuid) returns void language plpgsql set search_path = public as $$
declare d bigint; c bigint; n int;
begin
  select coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0), count(*) into d, c, n
  from journal_lines where entry_id = eid;
  if n < 2 or d <> c then
    raise exception 'journal entry % does not balance (debits %, credits %, % lines)', eid, d, c, n;
  end if;
end $$;
create or replace function private.check_line_entry() returns trigger language plpgsql security definer set search_path = public as $$
begin perform private.assert_entry_balanced(new.entry_id); return null; end $$;
create or replace function private.check_entry() returns trigger language plpgsql security definer set search_path = public as $$
begin perform private.assert_entry_balanced(new.id); return null; end $$;
create constraint trigger journal_lines_balanced after insert on journal_lines
  deferrable initially deferred for each row execute function private.check_line_entry();
create constraint trigger journal_entries_have_lines after insert on journal_entries
  deferrable initially deferred for each row execute function private.check_entry();

-- Locked periods can't receive new entries.
create or replace function private.check_period_open() returns trigger language plpgsql security definer set search_path = public as $$
declare locked date;
begin
  select books_locked_through into locked from shops where id = new.shop_id;
  if locked is not null and new.entry_date <= locked then
    raise exception 'the books are locked through %; nothing can be posted on %', locked, new.entry_date;
  end if;
  return new;
end $$;
create trigger journal_entries_period_open before insert on journal_entries for each row execute function private.check_period_open();

-- ───────── Documents ─────────
create table document_counters (
  shop_id    uuid not null references shops(id) on delete cascade,
  kind       text not null check (kind in ('invoice', 'credit_note')),
  next_value int not null check (next_value > 0),
  primary key (shop_id, kind)
);

create type invoice_status as enum ('unpaid', 'partial', 'paid', 'credited', 'void');
create type payment_method as enum ('cash', 'debit', 'credit', 'etransfer');

create table cash_sessions (
  id                   uuid primary key default gen_random_uuid(),
  shop_id              uuid not null references shops(id),
  opened_at            timestamptz not null default now(),
  opened_by            uuid not null references staff(id),
  open_expected_cents  bigint not null,
  open_counted_cents   bigint not null check (open_counted_cents >= 0),
  closed_at            timestamptz,
  closed_by            uuid references staff(id),
  close_expected_cents bigint,
  close_counted_cents  bigint check (close_counted_cents >= 0),
  over_short_cents     bigint,          -- counted − expected at close (negative = short)
  note                 text,
  unique (shop_id, id)
);
create unique index cash_sessions_one_open on cash_sessions (shop_id) where closed_at is null;

create table invoices (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references shops(id),
  number             int not null,
  customer_id        uuid references customers(id),
  ticket_id          uuid references tickets(id),
  issue_date         date not null,
  tax_name           text not null,
  tax_rate           numeric(6,4) not null check (tax_rate >= 0 and tax_rate < 1),
  subtotal_cents     bigint not null check (subtotal_cents >= 0),
  discount_cents     bigint not null check (discount_cents >= 0 and discount_cents <= subtotal_cents),
  taxable_base_cents bigint not null check (taxable_base_cents >= 0),
  tax_cents          bigint not null check (tax_cents >= 0),
  total_cents        bigint not null,
  paid_cents         bigint not null default 0 check (paid_cents >= 0),     -- payments + deposits applied − refunds
  credited_cents     bigint not null default 0 check (credited_cents >= 0), -- credit notes
  status             invoice_status not null default 'unpaid',
  notes              text,
  journal_entry_id   uuid,
  voided_at          timestamptz,
  voided_by          uuid references staff(id),
  void_reason        text,
  idempotency_key    uuid,
  created_by         uuid references staff(id),
  created_at         timestamptz not null default now(),
  check (total_cents = subtotal_cents - discount_cents + tax_cents),
  check (paid_cents + credited_cents <= total_cents),
  unique (shop_id, number),
  unique (shop_id, idempotency_key),
  unique (shop_id, id)
);
create index invoices_customer_idx on invoices (customer_id);
create index invoices_ticket_idx on invoices (ticket_id);
create index invoices_date_idx on invoices (shop_id, issue_date);

create table invoice_items (
  id                      uuid primary key default gen_random_uuid(),
  shop_id                 uuid not null references shops(id),
  invoice_id              uuid not null references invoices(id),
  line_no                 smallint not null,
  category                text not null check (category in ('repair', 'device', 'accessory', 'other')),
  description             text not null,
  imei_serial             text,
  qty                     int not null check (qty > 0),
  unit_price_cents        bigint not null check (unit_price_cents >= 0),
  gross_cents             bigint not null,
  discount_cents          bigint not null check (discount_cents >= 0),
  net_cents               bigint not null check (net_cents >= 0),
  tax_code                text not null check (tax_code in ('HST', 'EXEMPT')),
  tax_cents               bigint not null check (tax_cents >= 0),
  unit_cost_cents         bigint not null default 0 check (unit_cost_cents >= 0), -- for profit per repair; not posted
  credited_qty            int not null default 0,
  credited_gross_cents    bigint not null default 0,
  credited_discount_cents bigint not null default 0,
  credited_tax_cents      bigint not null default 0,
  check (gross_cents = qty * unit_price_cents),
  check (net_cents = gross_cents - discount_cents),
  check (credited_qty between 0 and qty),
  unique (invoice_id, line_no)
);

create table credit_notes (
  id               uuid primary key default gen_random_uuid(),
  shop_id          uuid not null references shops(id),
  number           int not null,
  invoice_id       uuid not null references invoices(id),
  issue_date       date not null,
  reason           text not null,
  gross_cents      bigint not null,
  discount_cents   bigint not null,
  tax_cents        bigint not null,
  total_cents      bigint not null check (total_cents > 0),
  journal_entry_id uuid,
  idempotency_key  uuid,
  created_by       uuid references staff(id),
  created_at       timestamptz not null default now(),
  check (total_cents = gross_cents - discount_cents + tax_cents),
  unique (shop_id, number),
  unique (shop_id, idempotency_key)
);

create table credit_note_items (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references shops(id),
  credit_note_id  uuid not null references credit_notes(id),
  invoice_item_id uuid not null references invoice_items(id),
  qty             int not null check (qty > 0),
  gross_cents     bigint not null,
  discount_cents  bigint not null,
  tax_cents       bigint not null
);

create table payments (
  id                   uuid primary key default gen_random_uuid(),
  shop_id              uuid not null references shops(id),
  kind                 text not null check (kind in ('payment', 'deposit', 'deposit_applied', 'deposit_unapplied', 'refund', 'deposit_refund')),
  method               payment_method,              -- null only when a deposit is moved onto/off an invoice
  amount_cents         bigint not null check (amount_cents > 0),  -- money that changed hands
  applied_cents        bigint not null check (applied_cents > 0), -- amount counted against the invoice/deposit
  rounding_cents       bigint not null default 0,   -- cash nickel rounding: applied − amount
  invoice_id           uuid references invoices(id),
  ticket_id            uuid references tickets(id),
  customer_id          uuid references customers(id),
  credit_note_id       uuid references credit_notes(id),
  cash_session_id      uuid references cash_sessions(id),
  reference            text,                        -- terminal auth / last 4 only, never a card number
  received_date        date not null,
  staff_id             uuid references staff(id),
  journal_entry_id     uuid,
  idempotency_key      uuid,
  created_at           timestamptz not null default now(),
  check ((kind in ('deposit_applied', 'deposit_unapplied')) = (method is null)),
  check (applied_cents - amount_cents = rounding_cents),
  check (rounding_cents = 0 or method = 'cash'),
  check (kind not in ('payment', 'refund', 'deposit_applied', 'deposit_unapplied') or invoice_id is not null),
  check (kind not in ('deposit', 'deposit_refund', 'deposit_applied', 'deposit_unapplied') or ticket_id is not null),
  unique (shop_id, idempotency_key)
);
create index payments_invoice_idx on payments (invoice_id);
create index payments_ticket_idx on payments (ticket_id);
create index payments_date_idx on payments (shop_id, received_date);

create table expenses (
  id               uuid primary key default gen_random_uuid(),
  shop_id          uuid not null references shops(id),
  expense_date     date not null,
  vendor           text not null,
  account_id       uuid not null,
  total_cents      bigint not null check (total_cents > 0),
  hst_cents        bigint not null default 0 check (hst_cents >= 0 and hst_cents <= total_cents),
  claim_itc        boolean not null default false,
  has_receipt      boolean not null default false,
  vendor_hst_no    text,
  paid_from        text not null check (paid_from in ('cash_drawer', 'bank', 'credit_card', 'owner')),
  ticket_id        uuid references tickets(id),     -- e.g. outsourced repair for this ticket
  reference        text,
  note             text,
  receipt_path     text,
  cash_session_id  uuid references cash_sessions(id),
  journal_entry_id uuid,
  voided_at        timestamptz,
  voided_by        uuid references staff(id),
  void_reason      text,
  idempotency_key  uuid,
  created_by       uuid references staff(id),
  created_at       timestamptz not null default now(),
  check (not claim_itc or hst_cents > 0),
  foreign key (shop_id, account_id) references accounts (shop_id, id),
  unique (shop_id, idempotency_key)
);
create index expenses_date_idx on expenses (shop_id, expense_date);

-- Journal line → document links (added now that the tables exist).
alter table journal_lines
  add foreign key (customer_id) references customers(id),
  add foreign key (invoice_id) references invoices(id),
  add foreign key (ticket_id) references tickets(id),
  add foreign key (payment_id) references payments(id),
  add foreign key (expense_id) references expenses(id),
  add foreign key (staff_id) references staff(id);

-- ───────── Seed a shop's books (runs for every new shop) ─────────
create or replace function private.seed_books(p_shop uuid) returns void language plpgsql set search_path = public as $$
begin
  insert into accounts (shop_id, code, name, type, normal_side, system_key, is_expense_category, itc_allowed, sort) values
    (p_shop, '1000', 'Cash drawer',                    'asset',     'D', 'cash',            false, true, 10),
    (p_shop, '1020', 'Bank account',                   'asset',     'D', 'bank',            false, true, 20),
    (p_shop, '1050', 'Card payments (Moneris)',        'asset',     'D', 'card_clearing',   false, true, 30),
    (p_shop, '1100', 'Customers owe us (A/R)',         'asset',     'D', 'ar',              false, true, 40),
    (p_shop, '2100', 'Business credit card',           'liability', 'C', 'credit_card',     false, true, 100),
    (p_shop, '2200', 'HST collected',                  'liability', 'C', 'hst_collected',   false, true, 110),
    (p_shop, '2210', 'HST paid on expenses (ITCs)',    'liability', 'D', 'hst_itc',         false, true, 120),
    (p_shop, '2300', 'Customer deposits',              'liability', 'C', 'deposits',        false, true, 130),
    (p_shop, '3000', 'Owner contributions',            'equity',    'C', 'owner_equity',    false, true, 200),
    (p_shop, '3100', 'Owner draws',                    'equity',    'D', 'owner_draws',     false, true, 210),
    (p_shop, '4000', 'Sales – Repairs',                'income',    'C', 'sales_repair',    false, true, 300),
    (p_shop, '4010', 'Sales – Devices',                'income',    'C', 'sales_device',    false, true, 310),
    (p_shop, '4020', 'Sales – Accessories',            'income',    'C', 'sales_accessory', false, true, 320),
    (p_shop, '4030', 'Sales – Other',                  'income',    'C', 'sales_other',     false, true, 330),
    (p_shop, '4900', 'Discounts given',                'income',    'D', 'discounts',       false, true, 390),
    (p_shop, '5000', 'Parts & supplies for repairs',   'expense',   'D', 'parts',           true,  true, 400),
    (p_shop, '5020', 'Outsourced repairs',             'expense',   'D', 'outsourced',      true,  true, 410),
    (p_shop, '6000', 'Rent',                           'expense',   'D', null,              true,  true, 500),
    (p_shop, '6010', 'Wages & payroll',                'expense',   'D', null,              true,  false, 510),
    (p_shop, '6020', 'Shop supplies',                  'expense',   'D', null,              true,  true, 520),
    (p_shop, '6030', 'Phone, internet & utilities',    'expense',   'D', null,              true,  true, 530),
    (p_shop, '6040', 'Software & subscriptions',       'expense',   'D', null,              true,  true, 540),
    (p_shop, '6050', 'Advertising',                    'expense',   'D', null,              true,  true, 550),
    (p_shop, '6060', 'Card processing fees',           'expense',   'D', null,              true,  false, 560),
    (p_shop, '6070', 'Bank fees',                      'expense',   'D', null,              true,  false, 570),
    (p_shop, '6080', 'Insurance',                      'expense',   'D', null,              true,  false, 580),
    (p_shop, '6090', 'Repairs & maintenance',          'expense',   'D', null,              true,  true, 590),
    (p_shop, '6100', 'Shipping & postage',             'expense',   'D', null,              true,  true, 600),
    (p_shop, '6110', 'Professional fees',              'expense',   'D', null,              true,  true, 610),
    (p_shop, '6190', 'Other expenses',                 'expense',   'D', 'other_expense',   true,  true, 690),
    (p_shop, '6900', 'Cash over/short',                'expense',   'D', 'cash_over_short', false, true, 900),
    (p_shop, '6910', 'Cash rounding (no pennies)',     'expense',   'D', 'cash_rounding',   false, true, 910);
  insert into document_counters (shop_id, kind, next_value)
  select p_shop, 'invoice', coalesce((select next_invoice_number from shops where id = p_shop), 1001)
  union all select p_shop, 'credit_note', 1;
end $$;

create or replace function private.on_shop_created() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform private.seed_books(new.id);
  return new;
end $$;
create trigger shops_seed_books after insert on shops for each row execute function private.on_shop_created();

select private.seed_books(id) from shops;

-- ───────── Helpers (private: not callable from the browser) ─────────

-- Who is calling, and are they allowed? Returns shop, staff and role, or stops with a clear error.
create or replace function private.ctx(p_roles staff_role[], out shop_id uuid, out staff_id uuid, out role staff_role)
language plpgsql stable security definer set search_path = public as $$
begin
  select s.shop_id, s.id, s.role into shop_id, staff_id, role
  from staff s where s.auth_user_id = auth.uid() and s.active;
  if staff_id is null then raise exception 'not signed in as staff'; end if;
  if not (role = any (p_roles)) then raise exception 'your role (%) can''t do this', role; end if;
end $$;

create or replace function private.shop_today(p_shop uuid) returns date language sql stable set search_path = public as $$
  select (now() at time zone coalesce(timezone, 'America/Toronto'))::date from shops where id = p_shop
$$;

create or replace function private.acct(p_shop uuid, p_key text) returns uuid language plpgsql stable set search_path = public as $$
declare a uuid;
begin
  select id into a from accounts where shop_id = p_shop and system_key = p_key;
  if a is null then raise exception 'account % is missing for this shop', p_key; end if;
  return a;
end $$;

create or replace function private.method_account(p_shop uuid, p_method payment_method) returns uuid language sql stable set search_path = public as $$
  select private.acct(p_shop, case p_method when 'cash' then 'cash' when 'etransfer' then 'bank' else 'card_clearing' end)
$$;

create or replace function private.account_balance(p_shop uuid, p_key text) returns bigint language sql stable set search_path = public as $$
  select coalesce(sum(debit_cents - credit_cents), 0)::bigint from journal_lines
  where shop_id = p_shop and account_id = private.acct(p_shop, p_key)
$$;

-- Canada has no pennies: cash totals round to the nearest 5 cents (1,2 → down; 3,4 → up; 6,7 → down; 8,9 → up).
create or replace function private.round_nickel(c bigint) returns bigint language sql immutable as $$
  select ((c + 2) / 5) * 5
$$;

-- Split a whole number of cents across weights so the parts add up exactly (largest remainder).
create or replace function private.allocate(p_total bigint, p_weights bigint[]) returns bigint[] language plpgsql immutable as $$
declare
  n int := coalesce(array_length(p_weights, 1), 0);
  w_sum numeric := 0; out bigint[] := '{}'; rem numeric[] := '{}'; given bigint := 0; i int; best int;
begin
  if n = 0 then return out; end if;
  for i in 1..n loop w_sum := w_sum + p_weights[i]; end loop;
  if p_total = 0 or w_sum = 0 then
    if p_total <> 0 then raise exception 'cannot split % cents over zero weights', p_total; end if;
    return array_fill(0::bigint, array[n]);
  end if;
  for i in 1..n loop
    out := out || floor(p_total::numeric * p_weights[i] / w_sum)::bigint;
    rem := rem || (p_total::numeric * p_weights[i]) % w_sum;
    given := given + out[i];
  end loop;
  while given < p_total loop      -- hand the leftover cents to the biggest remainders, first line wins ties
    best := 1;
    for i in 2..n loop if rem[i] > rem[best] then best := i; end if; end loop;
    out[best] := out[best] + 1; rem[best] := -1; given := given + 1;
  end loop;
  return out;
end $$;

create or replace function private.audit(p_shop uuid, p_staff uuid, p_action text, p_entity text, p_id uuid, p_detail jsonb)
returns void language sql set search_path = public as $$
  insert into audit_log (shop_id, staff_id, action, entity, entity_id, detail) values (p_shop, p_staff, p_action, p_entity, p_id, p_detail)
$$;

-- Write one balanced journal entry. p_lines: [{account, debit, credit, customer_id, invoice_id, ticket_id, payment_id, expense_id, staff_id, memo}]
-- Zero lines are skipped. Balance is checked here (clear error) and again at commit (can't be bypassed).
create or replace function private.post(p_shop uuid, p_staff uuid, p_date date, p_source text, p_source_id uuid, p_memo text,
                                        p_lines jsonb, p_reverses uuid default null)
returns uuid language plpgsql set search_path = public as $$
declare eid uuid; l jsonb; n int := 0; d bigint := 0; c bigint := 0; dv bigint; cv bigint;
begin
  insert into journal_entries (shop_id, entry_date, source_type, source_id, memo, reverses_entry_id, created_by)
  values (p_shop, p_date, p_source, p_source_id, p_memo, p_reverses, p_staff) returning id into eid;
  for l in select * from jsonb_array_elements(p_lines) loop
    dv := coalesce((l ->> 'debit')::bigint, 0); cv := coalesce((l ->> 'credit')::bigint, 0);
    if dv < 0 or cv < 0 then raise exception 'negative journal amount'; end if;
    continue when dv = 0 and cv = 0;
    n := n + 1; d := d + dv; c := c + cv;
    insert into journal_lines (shop_id, entry_id, line_no, account_id, debit_cents, credit_cents,
                               customer_id, invoice_id, ticket_id, payment_id, expense_id, staff_id, memo)
    values (p_shop, eid, n, (l ->> 'account')::uuid, dv, cv,
            (l ->> 'customer_id')::uuid, (l ->> 'invoice_id')::uuid, (l ->> 'ticket_id')::uuid,
            (l ->> 'payment_id')::uuid, (l ->> 'expense_id')::uuid, (l ->> 'staff_id')::uuid, l ->> 'memo');
  end loop;
  if n < 2 or d <> c then raise exception 'entry does not balance (debits %, credits %)', d, c; end if;
  return eid;
end $$;

-- Mirror an entry (debits ↔ credits), dated today, linked to the original.
create or replace function private.reverse_entry(p_shop uuid, p_staff uuid, p_entry uuid, p_source text, p_memo text)
returns uuid language plpgsql set search_path = public as $$
declare lines jsonb;
begin
  select jsonb_agg(jsonb_build_object('account', account_id, 'debit', credit_cents, 'credit', debit_cents,
           'customer_id', customer_id, 'invoice_id', invoice_id, 'ticket_id', ticket_id, 'payment_id', payment_id,
           'expense_id', expense_id, 'staff_id', staff_id, 'memo', memo) order by line_no)
  into lines from journal_lines where entry_id = p_entry and shop_id = p_shop;
  if lines is null then raise exception 'entry % not found', p_entry; end if;
  return private.post(p_shop, p_staff, private.shop_today(p_shop), p_source,
                      (select source_id from journal_entries where id = p_entry), p_memo, lines, p_entry);
end $$;

create or replace function private.next_doc(p_shop uuid, p_kind text) returns int language plpgsql set search_path = public as $$
declare n int;
begin
  update document_counters set next_value = next_value + 1 where shop_id = p_shop and kind = p_kind returning next_value - 1 into n;
  if n is null then raise exception 'no % numbering for this shop', p_kind; end if;
  return n;
end $$;

create or replace function private.open_session(p_shop uuid) returns uuid language sql stable set search_path = public as $$
  select id from cash_sessions where shop_id = p_shop and closed_at is null
$$;

create or replace function private.require_open_drawer(p_shop uuid) returns uuid language plpgsql stable set search_path = public as $$
declare s uuid := private.open_session(p_shop);
begin
  if s is null then raise exception 'open the cash drawer first (Cash drawer → Open)'; end if;
  return s;
end $$;

-- Whole cents from JSON: must be a non-negative whole number.
create or replace function private.cents(p jsonb, p_field text) returns bigint language plpgsql immutable as $$
declare v text := p ->> p_field;
begin
  if v is null or v !~ '^\d{1,12}$' then raise exception '% must be a whole number of cents (got %)', p_field, coalesce(v, 'nothing'); end if;
  return v::bigint;
end $$;

-- Keep an invoice's paid/credited/status in step with its payments and credit notes.
create or replace function private.refresh_invoice(p_invoice uuid) returns void language plpgsql set search_path = public as $$
declare paid bigint; credited bigint; inv invoices;
begin
  select * into inv from invoices where id = p_invoice;
  select coalesce(sum(case when kind in ('payment', 'deposit_applied') then applied_cents
                           when kind in ('refund', 'deposit_unapplied') then -applied_cents else 0 end), 0)
  into paid from payments where invoice_id = p_invoice;
  select coalesce(sum(total_cents), 0) into credited from credit_notes where invoice_id = p_invoice;
  update invoices set paid_cents = paid, credited_cents = credited,
    status = case
      when inv.voided_at is not null then 'void'
      when credited >= inv.total_cents and inv.total_cents > 0 then 'credited'
      when inv.total_cents - paid - credited <= 0 then 'paid'
      when paid > 0 then 'partial'
      else 'unpaid' end::invoice_status
  where id = p_invoice;
end $$;

-- What a ticket's customer has on deposit right now (from the ledger, never from a typed number).
create or replace function private.deposit_balance(p_ticket uuid) returns bigint language sql stable set search_path = public as $$
  select coalesce(sum(jl.credit_cents - jl.debit_cents), 0)::bigint
  from journal_lines jl join tickets t on t.id = jl.ticket_id
  where jl.ticket_id = p_ticket and jl.account_id = private.acct(t.shop_id, 'deposits')
$$;

-- ───────── Invoice maths (one source of truth for previews and real invoices) ─────────
-- p_lines: [{description, category, qty, unit_price_cents, unit_cost_cents, tax_code, imei_serial}]
create or replace function private.compute_invoice(p_lines jsonb, p_discount_cents bigint, p_rate numeric)
returns jsonb language plpgsql immutable as $$
declare
  l jsonb; i int := 0; n int;
  gross bigint[] := '{}'; disc bigint[]; tax_w bigint[] := '{}'; tax_a bigint[];
  subtotal bigint := 0; taxable bigint := 0; tax bigint; out_lines jsonb := '[]'; qty bigint; price bigint; code text; cat text;
begin
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'lines must be a list'; end if;
  n := jsonb_array_length(p_lines);
  if n = 0 then raise exception 'add at least one line'; end if;
  if n > 200 then raise exception 'too many lines (max 200)'; end if;
  if p_discount_cents is null or p_discount_cents < 0 then raise exception 'discount can''t be negative'; end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    if coalesce(btrim(l ->> 'description'), '') = '' then raise exception 'line %: description is empty', i; end if;
    if length(l ->> 'description') > 500 then raise exception 'line %: description too long', i; end if;
    qty := private.cents(l, 'qty');
    if qty < 1 or qty > 10000 then raise exception 'line %: quantity must be 1 to 10000', i; end if;
    price := private.cents(l, 'unit_price_cents');
    if price > 100000000 then raise exception 'line %: price too large', i; end if;
    if l ? 'unit_cost_cents' and l ->> 'unit_cost_cents' is not null then perform private.cents(l, 'unit_cost_cents'); end if;
    cat := coalesce(l ->> 'category', 'repair');
    if cat not in ('repair', 'device', 'accessory', 'other') then raise exception 'line %: unknown category %', i, cat; end if;
    code := coalesce(l ->> 'tax_code', 'HST');
    if code not in ('HST', 'EXEMPT') then raise exception 'line %: unknown tax code %', i, code; end if;
    gross := gross || (qty * price);
    subtotal := subtotal + qty * price;
  end loop;

  if p_discount_cents > subtotal then raise exception 'discount (%) is more than the subtotal (%)', p_discount_cents, subtotal; end if;
  disc := private.allocate(p_discount_cents, gross);

  i := 0;
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    tax_w := tax_w || case when coalesce(l ->> 'tax_code', 'HST') = 'HST' then gross[i] - disc[i] else 0 end;
    taxable := taxable + tax_w[i];
  end loop;
  tax := round(taxable * p_rate)::bigint;           -- one rounding per invoice, half up
  tax_a := private.allocate(tax, tax_w);

  i := 0;
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    out_lines := out_lines || jsonb_build_object(
      'line_no', i, 'description', btrim(l ->> 'description'), 'category', coalesce(l ->> 'category', 'repair'),
      'imei_serial', nullif(btrim(coalesce(l ->> 'imei_serial', '')), ''),
      'qty', (l ->> 'qty')::int, 'unit_price_cents', (l ->> 'unit_price_cents')::bigint,
      'unit_cost_cents', coalesce((l ->> 'unit_cost_cents')::bigint, 0),
      'tax_code', coalesce(l ->> 'tax_code', 'HST'),
      'gross_cents', gross[i], 'discount_cents', disc[i], 'net_cents', gross[i] - disc[i], 'tax_cents', tax_a[i]);
  end loop;

  return jsonb_build_object('lines', out_lines, 'subtotal_cents', subtotal, 'discount_cents', p_discount_cents,
    'taxable_base_cents', taxable, 'tax_cents', tax, 'total_cents', subtotal - p_discount_cents + tax);
end $$;

-- Take one payment against a locked invoice. Cash must be in 5¢ steps; paying the balance rounded to
-- the nearest 5¢ settles it exactly and the difference goes to "Cash rounding".
create or replace function private.take_payment(p_shop uuid, p_staff uuid, p_invoice uuid, p_method payment_method,
                                                p_amount bigint, p_reference text, p_key uuid)
returns uuid language plpgsql set search_path = public as $$
declare inv invoices; bal bigint; applied bigint; sess uuid; pid uuid; eid uuid;
begin
  select * into inv from invoices where id = p_invoice and shop_id = p_shop;
  if inv.voided_at is not null then raise exception 'invoice % is void', inv.number; end if;
  bal := inv.total_cents - inv.paid_cents - inv.credited_cents;
  if p_method is null then raise exception 'pick a payment method'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'payment must be more than $0'; end if;
  if bal <= 0 then raise exception 'invoice % is already paid', inv.number; end if;

  if p_method = 'cash' then
    sess := private.require_open_drawer(p_shop);
    if p_amount % 5 <> 0 then raise exception 'cash must be in 5¢ steps (no pennies)'; end if;
    if p_amount = private.round_nickel(bal) then applied := bal;          -- settles exactly
    elsif p_amount < bal then applied := p_amount;                         -- part payment
    else raise exception 'cash payment (%) is more than the balance (%); enter what is being paid, not what was handed over', p_amount, bal;
    end if;
  else
    if p_amount > bal then raise exception 'payment (%) is more than the balance (%)', p_amount, bal; end if;
    applied := p_amount;
  end if;

  insert into payments (shop_id, kind, method, amount_cents, applied_cents, rounding_cents, invoice_id, ticket_id, customer_id,
                        cash_session_id, reference, received_date, staff_id, idempotency_key)
  values (p_shop, 'payment', p_method, p_amount, applied, applied - p_amount, inv.id, inv.ticket_id, inv.customer_id,
          sess, nullif(btrim(coalesce(p_reference, '')), ''), private.shop_today(p_shop), p_staff, p_key)
  returning id into pid;

  eid := private.post(p_shop, p_staff, private.shop_today(p_shop), 'payment', pid, 'Payment on invoice ' || inv.number, jsonb_build_array(
    jsonb_build_object('account', private.method_account(p_shop, p_method), 'debit', p_amount, 'invoice_id', inv.id, 'customer_id', inv.customer_id, 'payment_id', pid, 'staff_id', p_staff),
    jsonb_build_object('account', private.acct(p_shop, 'cash_rounding'), 'debit', greatest(applied - p_amount, 0), 'invoice_id', inv.id, 'payment_id', pid),
    jsonb_build_object('account', private.acct(p_shop, 'ar'), 'credit', applied, 'invoice_id', inv.id, 'customer_id', inv.customer_id, 'payment_id', pid),
    jsonb_build_object('account', private.acct(p_shop, 'cash_rounding'), 'credit', greatest(p_amount - applied, 0), 'invoice_id', inv.id, 'payment_id', pid)));
  update payments set journal_entry_id = eid where id = pid;
  perform private.refresh_invoice(inv.id);
  return pid;
end $$;

-- ═════════════════════ Public functions (called from the app) ═════════════════════

-- Live totals for the invoice screen. Same maths as create_invoice, nothing saved.
create or replace function public.quote_invoice(p_lines jsonb, p_discount_cents bigint default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from private.ctx(array['owner', 'manager', 'front_desk']::staff_role[]);
  return private.compute_invoice(p_lines, coalesce(p_discount_cents, 0), (select tax_rate from shops where id = c.shop_id));
end $$;

-- Create an invoice (and optionally take payments) in one go. Safe to retry with the same key.
-- p_payments: [{method, amount_cents, reference}]
create or replace function public.create_invoice(p_customer_id uuid, p_ticket_id uuid, p_lines jsonb, p_discount_cents bigint,
                                                 p_payments jsonb, p_notes text, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record; shop shops; tk tickets; calc jsonb; inv_id uuid; num int; today date; l jsonb; p jsonb;
  dep bigint; apply bigint; pid uuid; eid uuid; existing invoices; issue_lines jsonb; cat_totals record;
begin
  select * into c from private.ctx(array['owner', 'manager', 'front_desk']::staff_role[]);
  if p_idempotency_key is null then raise exception 'missing idempotency key'; end if;
  select * into existing from invoices where shop_id = c.shop_id and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    return jsonb_build_object('id', existing.id, 'number', existing.number, 'replayed', true);
  end if;

  select * into shop from shops where id = c.shop_id;
  if p_ticket_id is not null then
    select * into tk from tickets where id = p_ticket_id and shop_id = c.shop_id for update;
    if tk.id is null then raise exception 'ticket not found'; end if;
    if p_customer_id is not null and p_customer_id <> tk.customer_id then raise exception 'customer doesn''t match the ticket'; end if;
    p_customer_id := tk.customer_id;
  end if;
  if p_customer_id is not null and not exists (select 1 from customers where id = p_customer_id and shop_id = c.shop_id) then
    raise exception 'customer not found';
  end if;

  calc := private.compute_invoice(p_lines, coalesce(p_discount_cents, 0), shop.tax_rate);
  today := private.shop_today(c.shop_id);
  num := private.next_doc(c.shop_id, 'invoice');

  insert into invoices (shop_id, number, customer_id, ticket_id, issue_date, tax_name, tax_rate, subtotal_cents, discount_cents,
                        taxable_base_cents, tax_cents, total_cents, notes, idempotency_key, created_by)
  values (c.shop_id, num, p_customer_id, p_ticket_id, today, coalesce(shop.tax_name, 'HST'), shop.tax_rate,
          (calc ->> 'subtotal_cents')::bigint, (calc ->> 'discount_cents')::bigint, (calc ->> 'taxable_base_cents')::bigint,
          (calc ->> 'tax_cents')::bigint, (calc ->> 'total_cents')::bigint, nullif(btrim(coalesce(p_notes, '')), ''),
          p_idempotency_key, c.staff_id)
  returning id into inv_id;

  for l in select * from jsonb_array_elements(calc -> 'lines') loop
    insert into invoice_items (shop_id, invoice_id, line_no, category, description, imei_serial, qty, unit_price_cents,
                               gross_cents, discount_cents, net_cents, tax_code, tax_cents, unit_cost_cents)
    values (c.shop_id, inv_id, (l ->> 'line_no')::int, l ->> 'category', l ->> 'description', l ->> 'imei_serial',
            (l ->> 'qty')::int, (l ->> 'unit_price_cents')::bigint, (l ->> 'gross_cents')::bigint, (l ->> 'discount_cents')::bigint,
            (l ->> 'net_cents')::bigint, l ->> 'tax_code', (l ->> 'tax_cents')::bigint, (l ->> 'unit_cost_cents')::bigint);
  end loop;

  -- Issue entry: customer owes the total; sales at full price by category; discount and HST separately.
  issue_lines := jsonb_build_array(
    jsonb_build_object('account', private.acct(c.shop_id, 'ar'), 'debit', (calc ->> 'total_cents')::bigint, 'invoice_id', inv_id, 'customer_id', p_customer_id, 'ticket_id', p_ticket_id),
    jsonb_build_object('account', private.acct(c.shop_id, 'discounts'), 'debit', (calc ->> 'discount_cents')::bigint, 'invoice_id', inv_id));
  for cat_totals in
    select category, sum(gross_cents)::bigint as gross from invoice_items where invoice_id = inv_id group by category order by category
  loop
    issue_lines := issue_lines || jsonb_build_object('account', private.acct(c.shop_id, 'sales_' || cat_totals.category),
                                                     'credit', cat_totals.gross, 'invoice_id', inv_id);
  end loop;
  issue_lines := issue_lines || jsonb_build_object('account', private.acct(c.shop_id, 'hst_collected'), 'credit', (calc ->> 'tax_cents')::bigint, 'invoice_id', inv_id);
  eid := private.post(c.shop_id, c.staff_id, today, 'invoice', inv_id, 'Invoice ' || num, issue_lines);
  update invoices set journal_entry_id = eid where id = inv_id;

  -- Deposit already taken on the ticket goes against this invoice (as much as it covers).
  if p_ticket_id is not null then
    dep := private.deposit_balance(p_ticket_id);
    apply := least(dep, (calc ->> 'total_cents')::bigint);
    if apply > 0 then
      insert into payments (shop_id, kind, method, amount_cents, applied_cents, invoice_id, ticket_id, customer_id, received_date, staff_id)
      values (c.shop_id, 'deposit_applied', null, apply, apply, inv_id, p_ticket_id, p_customer_id, today, c.staff_id)
      returning id into pid;
      eid := private.post(c.shop_id, c.staff_id, today, 'deposit_applied', pid, 'Deposit applied to invoice ' || num, jsonb_build_array(
        jsonb_build_object('account', private.acct(c.shop_id, 'deposits'), 'debit', apply, 'ticket_id', p_ticket_id, 'invoice_id', inv_id, 'customer_id', p_customer_id, 'payment_id', pid),
        jsonb_build_object('account', private.acct(c.shop_id, 'ar'), 'credit', apply, 'ticket_id', p_ticket_id, 'invoice_id', inv_id, 'customer_id', p_customer_id, 'payment_id', pid)));
      update payments set journal_entry_id = eid where id = pid;
      perform private.refresh_invoice(inv_id);
    end if;
  end if;

  for p in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    perform private.take_payment(c.shop_id, c.staff_id, inv_id, (p ->> 'method')::payment_method,
                                 private.cents(p, 'amount_cents'), p ->> 'reference', null);
  end loop;

  perform private.refresh_invoice(inv_id);
  perform private.audit(c.shop_id, c.staff_id, 'create_invoice', 'invoice', inv_id,
                        jsonb_build_object('number', num, 'total_cents', calc -> 'total_cents'));
  return jsonb_build_object('id', inv_id, 'number', num, 'replayed', false);
end $$;

create or replace function public.add_payment(p_invoice_id uuid, p_method payment_method, p_amount_cents bigint,
                                              p_reference text, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare c record; inv invoices; existing uuid; pid uuid;
begin
  select * into c from private.ctx(array['owner', 'manager', 'front_desk']::staff_role[]);
  if p_idempotency_key is null then raise exception 'missing idempotency key'; end if;
  select id into existing from payments where shop_id = c.shop_id and idempotency_key = p_idempotency_key;
  if existing is not null then return existing; end if;
  select * into inv from invoices where id = p_invoice_id and shop_id = c.shop_id for update;
  if inv.id is null then raise exception 'invoice not found'; end if;
  pid := private.take_payment(c.shop_id, c.staff_id, inv.id, p_method, p_amount_cents, p_reference, p_idempotency_key);
  perform private.audit(c.shop_id, c.staff_id, 'add_payment', 'invoice', inv.id,
                        jsonb_build_object('method', p_method, 'amount_cents', p_amount_cents));
  return pid;
end $$;

-- Deposit taken at check-in. It's the customer's money we're holding (a liability), not a sale yet.
create or replace function public.record_deposit(p_ticket_id uuid, p_method payment_method, p_amount_cents bigint,
                                                 p_reference text, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare c record; tk tickets; existing uuid; pid uuid; eid uuid; sess uuid; today date;
begin
  select * into c from private.ctx(array['owner', 'manager', 'front_desk', 'technician']::staff_role[]);
  if p_idempotency_key is null then raise exception 'missing idempotency key'; end if;
  select id into existing from payments where shop_id = c.shop_id and idempotency_key = p_idempotency_key;
  if existing is not null then return existing; end if;
  select * into tk from tickets where id = p_ticket_id and shop_id = c.shop_id for update;
  if tk.id is null then raise exception 'ticket not found'; end if;
  if tk.status in ('picked_up', 'cancelled') then raise exception 'ticket is closed'; end if;
  if p_method is null then raise exception 'pick a payment method'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'deposit must be more than $0'; end if;
  if p_method = 'cash' then
    sess := private.require_open_drawer(c.shop_id);
    if p_amount_cents % 5 <> 0 then raise exception 'cash must be in 5¢ steps (no pennies)'; end if;
  end if;
  today := private.shop_today(c.shop_id);
  insert into payments (shop_id, kind, method, amount_cents, applied_cents, ticket_id, customer_id, cash_session_id,
                        reference, received_date, staff_id, idempotency_key)
  values (c.shop_id, 'deposit', p_method, p_amount_cents, p_amount_cents, tk.id, tk.customer_id, sess,
          nullif(btrim(coalesce(p_reference, '')), ''), today, c.staff_id, p_idempotency_key)
  returning id into pid;
  eid := private.post(c.shop_id, c.staff_id, today, 'deposit', pid, 'Deposit on ticket ' || tk.number, jsonb_build_array(
    jsonb_build_object('account', private.method_account(c.shop_id, p_method), 'debit', p_amount_cents, 'ticket_id', tk.id, 'customer_id', tk.customer_id, 'payment_id', pid, 'staff_id', c.staff_id),
    jsonb_build_object('account', private.acct(c.shop_id, 'deposits'), 'credit', p_amount_cents, 'ticket_id', tk.id, 'customer_id', tk.customer_id, 'payment_id', pid)));
  update payments set journal_entry_id = eid where id = pid;
  perform private.audit(c.shop_id, c.staff_id, 'record_deposit', 'ticket', tk.id, jsonb_build_object('method', p_method, 'amount_cents', p_amount_cents));
  return pid;
end $$;

create or replace function public.refund_deposit(p_ticket_id uuid, p_method payment_method, p_amount_cents bigint,
                                                 p_reason text, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare c record; tk tickets; existing uuid; pid uuid; eid uuid; sess uuid; today date; bal bigint;
begin
  select * into c from private.ctx(array['owner', 'manager']::staff_role[]);
  if p_idempotency_key is null then raise exception 'missing idempotency key'; end if;
  select id into existing from payments where shop_id = c.shop_id and idempotency_key = p_idempotency_key;
  if existing is not null then return existing; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'give a reason for the refund'; end if;
  select * into tk from tickets where id = p_ticket_id and shop_id = c.shop_id for update;
  if tk.id is null then raise exception 'ticket not found'; end if;
  bal := private.deposit_balance(tk.id);
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'refund must be more than $0'; end if;
  if p_amount_cents > bal then raise exception 'refund (%) is more than the deposit held (%)', p_amount_cents, bal; end if;
  if p_method = 'cash' then
    sess := private.require_open_drawer(c.shop_id);
    if p_amount_cents % 5 <> 0 then raise exception 'cash must be in 5¢ steps (no pennies)'; end if;
  end if;
  today := private.shop_today(c.shop_id);
  insert into payments (shop_id, kind, method, amount_cents, applied_cents, ticket_id, customer_id, cash_session_id,
                        reference, received_date, staff_id, idempotency_key)
  values (c.shop_id, 'deposit_refund', p_method, p_amount_cents, p_amount_cents, tk.id, tk.customer_id, sess, p_reason, today, c.staff_id, p_idempotency_key)
  returning id into pid;
  eid := private.post(c.shop_id, c.staff_id, today, 'deposit_refund', pid, 'Deposit refund, ticket ' || tk.number || ': ' || p_reason, jsonb_build_array(
    jsonb_build_object('account', private.acct(c.shop_id, 'deposits'), 'debit', p_amount_cents, 'ticket_id', tk.id, 'customer_id', tk.customer_id, 'payment_id', pid),
    jsonb_build_object('account', private.method_account(c.shop_id, p_method), 'credit', p_amount_cents, 'ticket_id', tk.id, 'customer_id', tk.customer_id, 'payment_id', pid, 'staff_id', c.staff_id)));
  update payments set journal_entry_id = eid where id = pid;
  perform private.audit(c.shop_id, c.staff_id, 'refund_deposit', 'ticket', tk.id, jsonb_build_object('amount_cents', p_amount_cents, 'reason', p_reason));
  return pid;
end $$;

-- Deposit held on a ticket, for the ticket screen (any staff of the shop).
create or replace function public.ticket_deposit_cents(p_ticket_id uuid) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from private.ctx(array['owner', 'manager', 'front_desk', 'technician']::staff_role[]);
  if not exists (select 1 from tickets where id = p_ticket_id and shop_id = c.shop_id) then return 0; end if;
  return private.deposit_balance(p_ticket_id);
end $$;

-- Credit note: take back some or all lines (revenue + HST reversed line by line), refunding money if
-- needed. p_lines: [{invoice_item_id, qty}]  p_refunds: [{method, amount_cents}]
create or replace function public.create_credit_note(p_invoice_id uuid, p_lines jsonb, p_reason text, p_refunds jsonb, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record; inv invoices; it invoice_items; l jsonb; r jsonb; q int; existing credit_notes;
  g bigint; d bigint; tx bigint; tg bigint := 0; td bigint := 0; tt bigint := 0; total bigint; cn_id uuid; num int; today date;
  cn_lines jsonb := '[]'; cat record; refund_total bigint := 0; need bigint; amount bigint; applied bigint; pid uuid; eid uuid; sess uuid;
begin
  select * into c from private.ctx(array['owner', 'manager']::staff_role[]);
  if p_idempotency_key is null then raise exception 'missing idempotency key'; end if;
  select * into existing from credit_notes where shop_id = c.shop_id and idempotency_key = p_idempotency_key;
  if existing.id is not null then return jsonb_build_object('id', existing.id, 'number', existing.number, 'replayed', true); end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'give a reason for the credit'; end if;
  select * into inv from invoices where id = p_invoice_id and shop_id = c.shop_id for update;
  if inv.id is null then raise exception 'invoice not found'; end if;
  if inv.voided_at is not null then raise exception 'invoice % is void', inv.number; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'pick at least one line to credit'; end if;

  today := private.shop_today(c.shop_id);
  num := private.next_doc(c.shop_id, 'credit_note');
  insert into credit_notes (shop_id, number, invoice_id, issue_date, reason, gross_cents, discount_cents, tax_cents, total_cents, idempotency_key, created_by)
  values (c.shop_id, num, inv.id, today, p_reason, 1, 0, 0, 1, p_idempotency_key, c.staff_id) returning id into cn_id;  -- real totals set below

  for l in select * from jsonb_array_elements(p_lines) loop
    select * into it from invoice_items where id = (l ->> 'invoice_item_id')::uuid and invoice_id = inv.id for update;
    if it.id is null then raise exception 'line is not on this invoice'; end if;
    q := private.cents(l, 'qty')::int;
    if q < 1 or q > it.qty - it.credited_qty then raise exception 'line %: can credit at most % more', it.line_no, it.qty - it.credited_qty; end if;
    if q = it.qty - it.credited_qty then      -- last of the line: exactly what's left, so totals can never drift
      g := it.gross_cents - it.credited_gross_cents; d := it.discount_cents - it.credited_discount_cents; tx := it.tax_cents - it.credited_tax_cents;
    else                                       -- part of the line: round down, the final credit picks up the rest
      g := it.unit_price_cents * q; d := (it.discount_cents * q) / it.qty; tx := (it.tax_cents * q) / it.qty;
    end if;
    update invoice_items set credited_qty = credited_qty + q, credited_gross_cents = credited_gross_cents + g,
      credited_discount_cents = credited_discount_cents + d, credited_tax_cents = credited_tax_cents + tx where id = it.id;
    insert into credit_note_items (shop_id, credit_note_id, invoice_item_id, qty, gross_cents, discount_cents, tax_cents)
    values (c.shop_id, cn_id, it.id, q, g, d, tx);
    tg := tg + g; td := td + d; tt := tt + tx;
  end loop;
  total := tg - td + tt;
  if total <= 0 then raise exception 'nothing to credit'; end if;
  update credit_notes set gross_cents = tg, discount_cents = td, tax_cents = tt, total_cents = total where id = cn_id;

  -- Reverse revenue by category, HST and discount; the customer owes that much less.
  for cat in
    select ii.category, sum(cni.gross_cents)::bigint as gross from credit_note_items cni join invoice_items ii on ii.id = cni.invoice_item_id
    where cni.credit_note_id = cn_id group by ii.category order by ii.category
  loop
    cn_lines := cn_lines || jsonb_build_object('account', private.acct(c.shop_id, 'sales_' || cat.category), 'debit', cat.gross, 'invoice_id', inv.id);
  end loop;
  cn_lines := cn_lines
    || jsonb_build_object('account', private.acct(c.shop_id, 'hst_collected'), 'debit', tt, 'invoice_id', inv.id)
    || jsonb_build_object('account', private.acct(c.shop_id, 'discounts'), 'credit', td, 'invoice_id', inv.id)
    || jsonb_build_object('account', private.acct(c.shop_id, 'ar'), 'credit', total, 'invoice_id', inv.id, 'customer_id', inv.customer_id);
  eid := private.post(c.shop_id, c.staff_id, today, 'credit_note', cn_id, 'Credit note ' || num || ' on invoice ' || inv.number || ': ' || p_reason, cn_lines);
  update credit_notes set journal_entry_id = eid where id = cn_id;

  -- Money back: required when the customer has paid more than they now owe; never more than they paid.
  for r in select * from jsonb_array_elements(coalesce(p_refunds, '[]'::jsonb)) loop
    amount := private.cents(r, 'amount_cents');
    if amount <= 0 then raise exception 'refund must be more than $0'; end if;
    applied := amount;
    if (r ->> 'method') = 'cash' then
      sess := private.require_open_drawer(c.shop_id);
      if amount % 5 <> 0 then raise exception 'cash refunds must be in 5¢ steps'; end if;
    end if;
    refund_total := refund_total + amount;
    insert into payments (shop_id, kind, method, amount_cents, applied_cents, invoice_id, ticket_id, customer_id, credit_note_id,
                          cash_session_id, reference, received_date, staff_id)
    values (c.shop_id, 'refund', (r ->> 'method')::payment_method, amount, applied, inv.id, inv.ticket_id, inv.customer_id, cn_id,
            sess, p_reason, today, c.staff_id) returning id into pid;
    eid := private.post(c.shop_id, c.staff_id, today, 'refund', pid, 'Refund on invoice ' || inv.number, jsonb_build_array(
      jsonb_build_object('account', private.acct(c.shop_id, 'ar'), 'debit', applied, 'invoice_id', inv.id, 'customer_id', inv.customer_id, 'payment_id', pid),
      jsonb_build_object('account', private.method_account(c.shop_id, (r ->> 'method')::payment_method), 'credit', amount, 'invoice_id', inv.id, 'payment_id', pid, 'staff_id', c.staff_id)));
    update payments set journal_entry_id = eid where id = pid;
  end loop;

  need := inv.paid_cents + inv.credited_cents + total - inv.total_cents;   -- how much was overpaid after this credit
  if refund_total < need then raise exception 'customer has paid % more than they now owe; refund at least that', need; end if;
  if refund_total > inv.paid_cents then raise exception 'refund (%) is more than was paid (%)', refund_total, inv.paid_cents; end if;
  if refund_total > greatest(need, 0) then raise exception 'refund (%) is more than the customer is owed back (%)', refund_total, greatest(need, 0); end if;

  perform private.refresh_invoice(inv.id);
  perform private.audit(c.shop_id, c.staff_id, 'credit_note', 'invoice', inv.id,
                        jsonb_build_object('credit_note', num, 'total_cents', total, 'refund_cents', refund_total, 'reason', p_reason));
  return jsonb_build_object('id', cn_id, 'number', num, 'replayed', false);
end $$;

-- Void: only for an invoice nobody has paid (other than a deposit, which goes back on the ticket).
-- Its number stays used; the reversal is dated today.
create or replace function public.void_invoice(p_invoice_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c record; inv invoices; p payments; pid uuid; eid uuid; locked date;
begin
  select * into c from private.ctx(array['owner', 'manager']::staff_role[]);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'give a reason for voiding'; end if;
  select * into inv from invoices where id = p_invoice_id and shop_id = c.shop_id for update;
  if inv.id is null then raise exception 'invoice not found'; end if;
  if inv.voided_at is not null then raise exception 'invoice % is already void', inv.number; end if;
  if exists (select 1 from payments where invoice_id = inv.id and kind in ('payment', 'refund')) then
    raise exception 'invoice % has payments; use a credit note and refund instead', inv.number;
  end if;
  if inv.credited_cents > 0 then raise exception 'invoice % has a credit note; it can''t be voided', inv.number; end if;
  select books_locked_through into locked from shops where id = c.shop_id;
  if locked is not null and inv.issue_date <= locked then
    raise exception 'invoice % is in a locked period; use a credit note instead', inv.number;
  end if;

  perform private.reverse_entry(c.shop_id, c.staff_id, inv.journal_entry_id, 'invoice_void', 'Void invoice ' || inv.number || ': ' || p_reason);
  -- Put any deposit back on the ticket.
  for p in select * from payments where invoice_id = inv.id and kind = 'deposit_applied' loop
    insert into payments (shop_id, kind, method, amount_cents, applied_cents, invoice_id, ticket_id, customer_id, received_date, staff_id)
    values (c.shop_id, 'deposit_unapplied', null, p.applied_cents, p.applied_cents, inv.id, p.ticket_id, p.customer_id, private.shop_today(c.shop_id), c.staff_id)
    returning id into pid;
    eid := private.reverse_entry(c.shop_id, c.staff_id, p.journal_entry_id, 'deposit_unapplied', 'Deposit back on ticket (void invoice ' || inv.number || ')');
    update payments set journal_entry_id = eid where id = pid;
  end loop;
  update invoices set voided_at = now(), voided_by = c.staff_id, void_reason = p_reason where id = inv.id;
  perform private.refresh_invoice(inv.id);
  perform private.audit(c.shop_id, c.staff_id, 'void_invoice', 'invoice', inv.id, jsonb_build_object('number', inv.number, 'reason', p_reason));
end $$;

-- Owner/manager only: what each invoice line cost us (front desk doesn't see costs).
create or replace function public.invoice_item_costs(p_invoice_id uuid)
returns table (invoice_item_id uuid, unit_cost_cents bigint)
language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from private.ctx(array['owner', 'manager']::staff_role[]);
  return query select ii.id, ii.unit_cost_cents from invoice_items ii
    where ii.invoice_id = p_invoice_id and ii.shop_id = c.shop_id order by ii.line_no;
end $$;

-- ───────── Permissions on the new tables ─────────
do $$
declare t text;
begin
  foreach t in array array['accounts','journal_entries','journal_lines','document_counters','cash_sessions','invoices',
                           'invoice_items','credit_notes','credit_note_items','payments','expenses']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

-- Owner/manager: the whole ledger and expenses.
grant select on accounts, journal_entries, journal_lines, expenses to authenticated;
create policy accounts_select on accounts for select to authenticated using (shop_id = current_shop_id() and is_manager());
create policy journal_entries_select on journal_entries for select to authenticated using (shop_id = current_shop_id() and is_manager());
create policy journal_lines_select on journal_lines for select to authenticated using (shop_id = current_shop_id() and is_manager());
create policy expenses_select on expenses for select to authenticated using (shop_id = current_shop_id() and is_manager());

-- Owner/manager/front desk: invoices, payments, credit notes, drawer. Technicians: none of it.
grant select on invoices, credit_notes, credit_note_items, payments, cash_sessions to authenticated;
grant select (id, shop_id, invoice_id, line_no, category, description, imei_serial, qty, unit_price_cents, gross_cents,
              discount_cents, net_cents, tax_code, tax_cents, credited_qty, credited_gross_cents, credited_discount_cents,
              credited_tax_cents)
  on invoice_items to authenticated;     -- not unit_cost_cents (see invoice_item_costs)
create policy invoices_select on invoices for select to authenticated
  using (shop_id = current_shop_id() and current_staff_role() in ('owner', 'manager', 'front_desk'));
create policy invoice_items_select on invoice_items for select to authenticated
  using (shop_id = current_shop_id() and current_staff_role() in ('owner', 'manager', 'front_desk'));
create policy credit_notes_select on credit_notes for select to authenticated
  using (shop_id = current_shop_id() and current_staff_role() in ('owner', 'manager', 'front_desk'));
create policy credit_note_items_select on credit_note_items for select to authenticated
  using (shop_id = current_shop_id() and current_staff_role() in ('owner', 'manager', 'front_desk'));
create policy payments_select on payments for select to authenticated
  using (shop_id = current_shop_id() and current_staff_role() in ('owner', 'manager', 'front_desk'));
create policy cash_sessions_select on cash_sessions for select to authenticated
  using (shop_id = current_shop_id() and current_staff_role() in ('owner', 'manager', 'front_desk'));

-- Functions: only the app's public money functions are callable, and only when signed in.
revoke all on all functions in schema private from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['quote_invoice(jsonb,bigint)',
    'create_invoice(uuid,uuid,jsonb,bigint,jsonb,text,uuid)', 'add_payment(uuid,payment_method,bigint,text,uuid)',
    'record_deposit(uuid,payment_method,bigint,text,uuid)', 'refund_deposit(uuid,payment_method,bigint,text,uuid)',
    'ticket_deposit_cents(uuid)', 'create_credit_note(uuid,jsonb,text,jsonb,uuid)', 'void_invoice(uuid,text)',
    'invoice_item_costs(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
