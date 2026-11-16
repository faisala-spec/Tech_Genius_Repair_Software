-- 009: expenses (with HST claimed back), the daily cash drawer, and locking finished months.
-- Tests: test/db/expenses_cash.test.ts. Uses the helpers from 008.

alter table expenses add column cash_rounding_cents bigint not null default 0;  -- cash only: bill − cash that left the drawer

create table cash_movements (
  id               uuid primary key default gen_random_uuid(),
  shop_id          uuid not null references shops(id),
  cash_session_id  uuid not null references cash_sessions(id),
  kind             text not null check (kind in ('bank_deposit', 'owner_draw', 'float_from_bank', 'owner_contribution')),
  amount_cents     bigint not null check (amount_cents > 0),
  note             text,
  staff_id         uuid not null references staff(id),
  journal_entry_id uuid,
  created_at       timestamptz not null default now()
);

-- ───────── Expenses ─────────
-- p_paid_from: cash_drawer | bank | credit_card | owner (owner paid personally)
create or replace function public.create_expense(
  p_date date, p_vendor text, p_account_id uuid, p_total_cents bigint, p_hst_cents bigint, p_claim_itc boolean,
  p_has_receipt boolean, p_vendor_hst_no text, p_paid_from text, p_ticket_id uuid, p_reference text, p_note text,
  p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare c record; a accounts; existing uuid; eid uuid; xid uuid; today date; sess uuid; itc bigint; cash_out bigint := 0; rounding bigint := 0;
        credit_acct uuid;
begin
  select * into c from private.ctx(array['owner', 'manager']::staff_role[]);
  if p_idempotency_key is null then raise exception 'missing idempotency key'; end if;
  select id into existing from expenses where shop_id = c.shop_id and idempotency_key = p_idempotency_key;
  if existing is not null then return existing; end if;

  today := private.shop_today(c.shop_id);
  if p_date is null then raise exception 'pick the date on the receipt'; end if;
  if p_date > today then raise exception 'an expense can''t be dated in the future'; end if;
  if coalesce(btrim(p_vendor), '') = '' then raise exception 'who was paid? (vendor)'; end if;
  select * into a from accounts where id = p_account_id and shop_id = c.shop_id;
  if a.id is null or not a.is_expense_category or not a.active then raise exception 'pick an expense category'; end if;
  if p_total_cents is null or p_total_cents <= 0 then raise exception 'amount must be more than $0'; end if;
  if p_hst_cents is null or p_hst_cents < 0 or p_hst_cents > p_total_cents then raise exception 'HST must be between $0 and the total'; end if;
  if coalesce(p_claim_itc, false) and p_hst_cents = 0 then raise exception 'there''s no HST to claim back'; end if;
  if coalesce(p_claim_itc, false) and not a.itc_allowed then raise exception 'HST on % can''t be claimed back', a.name; end if;
  if p_ticket_id is not null and not exists (select 1 from tickets where id = p_ticket_id and shop_id = c.shop_id) then
    raise exception 'ticket not found';
  end if;
  itc := case when coalesce(p_claim_itc, false) then p_hst_cents else 0 end;

  credit_acct := case p_paid_from
    when 'cash_drawer' then private.acct(c.shop_id, 'cash')
    when 'bank' then private.acct(c.shop_id, 'bank')
    when 'credit_card' then private.acct(c.shop_id, 'credit_card')
    when 'owner' then private.acct(c.shop_id, 'owner_equity') end;
  if credit_acct is null then raise exception 'how was it paid? (cash drawer, bank, credit card or owner)'; end if;
  if p_paid_from = 'cash_drawer' then
    if p_date <> today then raise exception 'cash from the drawer can only be recorded on the day it''s taken'; end if;
    sess := private.require_open_drawer(c.shop_id);
    cash_out := private.round_nickel(p_total_cents);   -- no pennies: the drawer pays the nearest 5¢
    rounding := p_total_cents - cash_out;
  end if;

  insert into expenses (shop_id, expense_date, vendor, account_id, total_cents, hst_cents, claim_itc, has_receipt, vendor_hst_no,
                        paid_from, ticket_id, reference, note, cash_session_id, cash_rounding_cents, idempotency_key, created_by)
  values (c.shop_id, p_date, btrim(p_vendor), a.id, p_total_cents, p_hst_cents, coalesce(p_claim_itc, false), coalesce(p_has_receipt, false),
          nullif(btrim(coalesce(p_vendor_hst_no, '')), ''), p_paid_from, p_ticket_id, nullif(btrim(coalesce(p_reference, '')), ''),
          nullif(btrim(coalesce(p_note, '')), ''), sess, rounding, p_idempotency_key, c.staff_id)
  returning id into xid;

  eid := private.post(c.shop_id, c.staff_id, p_date, 'expense', xid, btrim(p_vendor) || ' – ' || a.name, jsonb_build_array(
    jsonb_build_object('account', a.id, 'debit', p_total_cents - itc, 'expense_id', xid, 'ticket_id', p_ticket_id),
    jsonb_build_object('account', private.acct(c.shop_id, 'hst_itc'), 'debit', itc, 'expense_id', xid),
    jsonb_build_object('account', private.acct(c.shop_id, 'cash_rounding'), 'debit', greatest(-rounding, 0), 'expense_id', xid),
    jsonb_build_object('account', credit_acct, 'credit', p_total_cents - rounding, 'expense_id', xid, 'staff_id', c.staff_id),
    jsonb_build_object('account', private.acct(c.shop_id, 'cash_rounding'), 'credit', greatest(rounding, 0), 'expense_id', xid)));
  update expenses set journal_entry_id = eid where id = xid;
  perform private.audit(c.shop_id, c.staff_id, 'create_expense', 'expense', xid,
                        jsonb_build_object('vendor', p_vendor, 'category', a.name, 'total_cents', p_total_cents, 'hst_cents', p_hst_cents));
  return xid;
end $$;

create or replace function public.void_expense(p_expense_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c record; x expenses;
begin
  select * into c from private.ctx(array['owner', 'manager']::staff_role[]);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'give a reason'; end if;
  select * into x from expenses where id = p_expense_id and shop_id = c.shop_id for update;
  if x.id is null then raise exception 'expense not found'; end if;
  if x.voided_at is not null then raise exception 'expense is already void'; end if;
  if x.paid_from = 'cash_drawer' then perform private.require_open_drawer(c.shop_id); end if;  -- the cash goes back in the drawer
  perform private.reverse_entry(c.shop_id, c.staff_id, x.journal_entry_id, 'expense_void', 'Void expense: ' || p_reason);
  update expenses set voided_at = now(), voided_by = c.staff_id, void_reason = p_reason where id = x.id;
  perform private.audit(c.shop_id, c.staff_id, 'void_expense', 'expense', x.id, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.create_expense_category(p_name text, p_itc_allowed boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare c record; code int; aid uuid;
begin
  select * into c from private.ctx(array['owner', 'manager']::staff_role[]);
  if coalesce(btrim(p_name), '') = '' then raise exception 'name the category'; end if;
  if exists (select 1 from accounts where shop_id = c.shop_id and lower(name) = lower(btrim(p_name))) then
    raise exception 'there''s already a category called %', btrim(p_name);
  end if;
  select coalesce(max(a.code::int), 6000) + 1 into code from accounts a
  where a.shop_id = c.shop_id and a.code ~ '^\d+$' and a.code::int between 6000 and 6899;
  if code > 6899 then raise exception 'too many categories'; end if;
  insert into accounts (shop_id, code, name, type, normal_side, is_expense_category, itc_allowed, sort)
  values (c.shop_id, code::text, btrim(p_name), 'expense', 'D', true, coalesce(p_itc_allowed, true), code)
  returning id into aid;
  perform private.audit(c.shop_id, c.staff_id, 'create_category', 'account', aid, jsonb_build_object('name', p_name));
  return aid;
end $$;

-- Owner: rename an account or hide an expense category. System accounts can be renamed but not hidden.
create or replace function public.update_account(p_account_id uuid, p_name text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c record; a accounts;
begin
  select * into c from private.ctx(array['owner']::staff_role[]);
  select * into a from accounts where id = p_account_id and shop_id = c.shop_id for update;
  if a.id is null then raise exception 'account not found'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'name can''t be empty'; end if;
  if not coalesce(p_active, true) and a.system_key is not null then raise exception '% is needed by the system and can''t be hidden', a.name; end if;
  update accounts set name = btrim(p_name), active = coalesce(p_active, true) where id = a.id;
  perform private.audit(c.shop_id, c.staff_id, 'update_account', 'account', a.id,
                        jsonb_build_object('before', jsonb_build_object('name', a.name, 'active', a.active), 'after', jsonb_build_object('name', p_name, 'active', p_active)));
end $$;

-- ───────── Cash drawer ─────────
-- Expected cash always comes from the ledger. The very first count is the starting float (owner's money);
-- after that, any difference is over/short and is pinned on the person counting.
create or replace function public.open_cash_session(p_counted_cents bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; expected bigint; diff bigint; sid uuid; first_ever boolean; today date;
begin
  select * into c from private.ctx(array['owner', 'manager', 'front_desk', 'technician']::staff_role[]);
  if p_counted_cents is null or p_counted_cents < 0 then raise exception 'count the drawer first'; end if;
  if p_counted_cents % 5 <> 0 then raise exception 'cash counts are in 5¢ steps'; end if;
  perform 1 from shops where id = c.shop_id for update;                 -- one opener at a time
  if private.open_session(c.shop_id) is not null then raise exception 'the drawer is already open'; end if;
  first_ever := not exists (select 1 from cash_sessions where shop_id = c.shop_id);
  expected := private.account_balance(c.shop_id, 'cash');
  diff := p_counted_cents - expected;
  insert into cash_sessions (shop_id, opened_by, open_expected_cents, open_counted_cents)
  values (c.shop_id, c.staff_id, expected, p_counted_cents) returning id into sid;
  today := private.shop_today(c.shop_id);
  if diff <> 0 then
    perform private.post(c.shop_id, c.staff_id, today, 'cash_count', sid,
      case when first_ever then 'Starting cash float' else 'Drawer count at opening' end,
      jsonb_build_array(
        jsonb_build_object('account', private.acct(c.shop_id, 'cash'), 'debit', greatest(diff, 0), 'credit', greatest(-diff, 0), 'staff_id', c.staff_id),
        jsonb_build_object('account', private.acct(c.shop_id, case when first_ever then 'owner_equity' else 'cash_over_short' end),
                           'debit', greatest(-diff, 0), 'credit', greatest(diff, 0), 'staff_id', c.staff_id)));
  end if;
  perform private.audit(c.shop_id, c.staff_id, 'open_drawer', 'cash_session', sid, jsonb_build_object('expected', expected, 'counted', p_counted_cents));
  return jsonb_build_object('id', sid, 'expected_cents', expected, 'counted_cents', p_counted_cents, 'difference_cents', diff, 'starting_float', first_ever);
end $$;

create or replace function public.close_cash_session(p_counted_cents bigint, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; s cash_sessions; expected bigint; diff bigint;
begin
  select * into c from private.ctx(array['owner', 'manager', 'front_desk', 'technician']::staff_role[]);
  if p_counted_cents is null or p_counted_cents < 0 then raise exception 'count the drawer first'; end if;
  if p_counted_cents % 5 <> 0 then raise exception 'cash counts are in 5¢ steps'; end if;
  select * into s from cash_sessions where shop_id = c.shop_id and closed_at is null for update;
  if s.id is null then raise exception 'the drawer isn''t open'; end if;
  expected := private.account_balance(c.shop_id, 'cash');
  diff := p_counted_cents - expected;
  if diff <> 0 then
    perform private.post(c.shop_id, c.staff_id, private.shop_today(c.shop_id), 'cash_count', s.id,
      case when diff < 0 then 'Drawer short at close' else 'Drawer over at close' end,
      jsonb_build_array(
        jsonb_build_object('account', private.acct(c.shop_id, 'cash'), 'debit', greatest(diff, 0), 'credit', greatest(-diff, 0), 'staff_id', c.staff_id),
        jsonb_build_object('account', private.acct(c.shop_id, 'cash_over_short'), 'debit', greatest(-diff, 0), 'credit', greatest(diff, 0), 'staff_id', c.staff_id)));
  end if;
  update cash_sessions set closed_at = now(), closed_by = c.staff_id, close_expected_cents = expected,
    close_counted_cents = p_counted_cents, over_short_cents = diff, note = nullif(btrim(coalesce(p_note, '')), '')
  where id = s.id;
  perform private.audit(c.shop_id, c.staff_id, 'close_drawer', 'cash_session', s.id,
                        jsonb_build_object('expected', expected, 'counted', p_counted_cents, 'over_short', diff));
  return jsonb_build_object('id', s.id, 'expected_cents', expected, 'counted_cents', p_counted_cents, 'over_short_cents', diff);
end $$;

-- Cash in/out that isn't a sale: bank deposit, owner taking cash, topping up the float.
create or replace function public.cash_movement(p_kind text, p_amount_cents bigint, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c record; sess uuid; mid uuid; eid uuid; dr text; cr text; today date;
begin
  select * into c from private.ctx(array['owner', 'manager']::staff_role[]);
  sess := private.require_open_drawer(c.shop_id);
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'amount must be more than $0'; end if;
  if p_amount_cents % 5 <> 0 then raise exception 'cash is in 5¢ steps'; end if;
  case p_kind
    when 'bank_deposit' then dr := 'bank'; cr := 'cash';
    when 'owner_draw' then dr := 'owner_draws'; cr := 'cash';
    when 'float_from_bank' then dr := 'cash'; cr := 'bank';
    when 'owner_contribution' then dr := 'cash'; cr := 'owner_equity';
    else raise exception 'unknown cash movement %', p_kind;
  end case;
  if cr = 'cash' and p_amount_cents > private.account_balance(c.shop_id, 'cash') then
    raise exception 'there isn''t that much cash in the drawer';
  end if;
  today := private.shop_today(c.shop_id);
  insert into cash_movements (shop_id, cash_session_id, kind, amount_cents, note, staff_id)
  values (c.shop_id, sess, p_kind, p_amount_cents, nullif(btrim(coalesce(p_note, '')), ''), c.staff_id) returning id into mid;
  eid := private.post(c.shop_id, c.staff_id, today, 'cash_movement', mid, replace(initcap(replace(p_kind, '_', ' ')), 'From', 'from'), jsonb_build_array(
    jsonb_build_object('account', private.acct(c.shop_id, dr), 'debit', p_amount_cents, 'staff_id', c.staff_id),
    jsonb_build_object('account', private.acct(c.shop_id, cr), 'credit', p_amount_cents, 'staff_id', c.staff_id)));
  update cash_movements set journal_entry_id = eid where id = mid;
  perform private.audit(c.shop_id, c.staff_id, 'cash_movement', 'cash_movement', mid, jsonb_build_object('kind', p_kind, 'amount_cents', p_amount_cents));
  return mid;
end $$;

-- ───────── Locking finished periods ─────────
-- Once the accountant has a month, lock it: nothing can be posted on or before that date.
create or replace function public.lock_books(p_through date)
returns void language plpgsql security definer set search_path = public as $$
declare c record; cur date;
begin
  select * into c from private.ctx(array['owner']::staff_role[]);
  if p_through is null then raise exception 'pick a date'; end if;
  if p_through >= private.shop_today(c.shop_id) then raise exception 'you can only lock days that are over'; end if;
  select books_locked_through into cur from shops where id = c.shop_id for update;
  if cur is not null and p_through <= cur then raise exception 'the books are already locked through %', cur; end if;
  if exists (select 1 from cash_sessions where shop_id = c.shop_id and closed_at is null
             and (opened_at at time zone (select coalesce(timezone, 'America/Toronto') from shops where id = c.shop_id))::date <= p_through) then
    raise exception 'close the cash drawer first';
  end if;
  update shops set books_locked_through = p_through where id = c.shop_id;
  perform private.audit(c.shop_id, c.staff_id, 'lock_books', 'shop', c.shop_id, jsonb_build_object('before', cur, 'after', p_through));
end $$;

create or replace function public.unlock_books(p_through date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c record; cur date;
begin
  select * into c from private.ctx(array['owner']::staff_role[]);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'give a reason for unlocking'; end if;
  select books_locked_through into cur from shops where id = c.shop_id for update;
  if cur is null then raise exception 'the books aren''t locked'; end if;
  if p_through is not null and p_through >= cur then raise exception 'to unlock, pick a date before %', cur; end if;
  update shops set books_locked_through = p_through where id = c.shop_id;
  perform private.audit(c.shop_id, c.staff_id, 'unlock_books', 'shop', c.shop_id, jsonb_build_object('before', cur, 'after', p_through, 'reason', p_reason));
end $$;

-- ───────── Permissions ─────────
alter table cash_movements enable row level security;
revoke all on cash_movements from anon, authenticated;
grant select on cash_movements to authenticated;
create policy cash_movements_select on cash_movements for select to authenticated
  using (shop_id = current_shop_id() and current_staff_role() in ('owner', 'manager', 'front_desk'));

-- Front desk needs the drawer screen but not the ledger: give them the expected amount through a function.
create or replace function public.drawer_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record; s cash_sessions;
begin
  select * into c from private.ctx(array['owner', 'manager', 'front_desk', 'technician']::staff_role[]);
  select * into s from cash_sessions where shop_id = c.shop_id and closed_at is null;
  return jsonb_build_object('open', s.id is not null, 'session_id', s.id, 'opened_at', s.opened_at,
    'opened_by', (select full_name from staff where id = s.opened_by),
    'expected_cents', case when s.id is not null and c.role in ('owner', 'manager') then private.account_balance(c.shop_id, 'cash') end);
end $$;

revoke all on all functions in schema private from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'create_expense(date,text,uuid,bigint,bigint,boolean,boolean,text,text,uuid,text,text,uuid)', 'void_expense(uuid,text)',
    'create_expense_category(text,boolean)', 'update_account(uuid,text,boolean)',
    'open_cash_session(bigint)', 'close_cash_session(bigint,text)', 'cash_movement(text,bigint,text)', 'drawer_status()',
    'lock_books(date)', 'unlock_books(date,text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
