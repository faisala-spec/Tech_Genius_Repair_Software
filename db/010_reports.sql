-- 010: reports. Every number comes from the journal (or, for counts, from the documents), filtered by
-- the shop's local date. Owner/manager only. Amounts are whole cents.
-- Tests: test/db/reports.test.ts

-- Signed balance per account between two dates (inclusive), positive in the account's normal direction.
create or replace function private.account_movements(p_shop uuid, p_from date, p_to date)
returns table (account_id uuid, code text, name text, type text, system_key text, amount_cents bigint)
language sql stable set search_path = public as $$
  select a.id, a.code, a.name, a.type, a.system_key,
         coalesce(sum(case when a.normal_side = 'D' then jl.debit_cents - jl.credit_cents
                           else jl.credit_cents - jl.debit_cents end), 0)::bigint
  from accounts a
  left join journal_lines jl on jl.account_id = a.id
  left join journal_entries je on je.id = jl.entry_id
  where a.shop_id = p_shop
    and (jl.id is null or (je.entry_date between coalesce(p_from, '-infinity'::date) and p_to))
  group by a.id, a.code, a.name, a.type, a.system_key
$$;

create or replace function private.check_range(p_from date, p_to date) returns void language plpgsql immutable as $$
begin
  if p_from is null or p_to is null then raise exception 'pick a date range'; end if;
  if p_to < p_from then raise exception 'the end date is before the start date'; end if;
  if p_to - p_from > 3700 then raise exception 'date range too long (10 years max)'; end if;
end $$;

-- ───────── Profit & loss ─────────
-- section: income | cost_of_sales | expense.  Income is positive; "Discounts given" shows as negative income.
create or replace function public.report_pnl(p_from date, p_to date)
returns table (section text, code text, name text, amount_cents bigint)
language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from private.ctx(array['owner', 'manager']::staff_role[]);
  perform private.check_range(p_from, p_to);
  return query
    select case when m.type = 'income' then 'income' when m.code < '6000' then 'cost_of_sales' else 'expense' end,
           m.code, m.name,
           case when m.system_key = 'discounts' then -m.amount_cents else m.amount_cents end
    from private.account_movements(c.shop_id, p_from, p_to) m
    where m.type in ('income', 'expense') and m.amount_cents <> 0
    order by m.code;
end $$;

-- ───────── Balance sheet ─────────
-- Assets = what the shop has; liabilities = what it owes (HST, deposits, card); equity = owner's share.
-- "Profit to date" (retained earnings) closes the gap, so assets always = liabilities + equity.
create or replace function public.report_balance_sheet(p_as_of date)
returns table (section text, code text, name text, amount_cents bigint)
language plpgsql stable security definer set search_path = public as $$
declare c record; profit bigint;
begin
  select * into c from private.ctx(array['owner', 'manager']::staff_role[]);
  if p_as_of is null then raise exception 'pick a date'; end if;
  select coalesce(sum(case when m.type = 'income' then m.amount_cents * (case when m.system_key = 'discounts' then -1 else 1 end)
                           else -m.amount_cents end), 0)
  into profit from private.account_movements(c.shop_id, null, p_as_of) m where m.type in ('income', 'expense');
  return query
    select m.type, m.code, m.name,
           -- ITCs are a debit-side liability: show them as reducing what's owed.
           case when m.system_key = 'hst_itc' then -m.amount_cents
                when m.system_key = 'owner_draws' then -m.amount_cents else m.amount_cents end
    from private.account_movements(c.shop_id, null, p_as_of) m
    where m.type in ('asset', 'liability', 'equity') and m.amount_cents <> 0
    union all select 'equity', '3900', 'Profit to date', profit
    order by 2;
end $$;

-- ───────── HST return (Regular method), lines as on the CRA form ─────────
create or replace function public.report_hst(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record; sales bigint; collected bigint; itc bigint; no_receipt record;
begin
  select * into c from private.ctx(array['owner', 'manager']::staff_role[]);
  perform private.check_range(p_from, p_to);
  select coalesce(sum(case when system_key = 'discounts' then -amount_cents else amount_cents end), 0) into sales
    from private.account_movements(c.shop_id, p_from, p_to) where type = 'income';
  select coalesce(sum(amount_cents), 0) into collected from private.account_movements(c.shop_id, p_from, p_to) where system_key = 'hst_collected';
  select coalesce(sum(amount_cents), 0) into itc from private.account_movements(c.shop_id, p_from, p_to) where system_key = 'hst_itc';
  select count(*) as n, coalesce(sum(hst_cents), 0) as cents into no_receipt from expenses
    where shop_id = c.shop_id and claim_itc and not has_receipt and voided_at is null and expense_date between p_from and p_to;
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'line_101_sales_cents', sales,
    'line_103_hst_collected_cents', collected,
    'line_105_total_cents', collected,
    'line_106_itc_cents', itc,
    'line_108_total_itc_cents', itc,
    'line_109_net_tax_cents', collected - itc,
    'itcs_without_receipt', no_receipt.n,
    'itcs_without_receipt_cents', no_receipt.cents);
end $$;

-- ───────── Unpaid invoices by age ─────────
create or replace function public.report_ar_aging(p_as_of date)
returns table (invoice_id uuid, number int, issue_date date, customer text, days_old int, balance_cents bigint)
language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from private.ctx(array['owner', 'manager']::staff_role[]);
  if p_as_of is null then raise exception 'pick a date'; end if;
  return query
    select i.id, i.number, i.issue_date,
           coalesce(nullif(btrim(coalesce(cu.first_name, '') || ' ' || coalesce(cu.last_name, '')), ''), cu.company, 'Walk-in'),
           (p_as_of - i.issue_date)::int,
           sum(jl.debit_cents - jl.credit_cents)::bigint
    from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    join invoices i on i.id = jl.invoice_id
    left join customers cu on cu.id = i.customer_id
    where jl.shop_id = c.shop_id and jl.account_id = private.acct(c.shop_id, 'ar') and je.entry_date <= p_as_of
    group by i.id, i.number, i.issue_date, cu.first_name, cu.last_name, cu.company
    having sum(jl.debit_cents - jl.credit_cents) <> 0
    order by i.issue_date, i.number;
end $$;

-- ───────── Money taken, by method ─────────
create or replace function public.report_payments(p_from date, p_to date)
returns table (method payment_method, payments_cents bigint, deposits_cents bigint, refunds_cents bigint, net_cents bigint, count bigint)
language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from private.ctx(array['owner', 'manager']::staff_role[]);
  perform private.check_range(p_from, p_to);
  return query
    select p.method,
           coalesce(sum(p.amount_cents) filter (where p.kind = 'payment'), 0)::bigint,
           coalesce(sum(p.amount_cents) filter (where p.kind = 'deposit'), 0)::bigint,
           coalesce(sum(p.amount_cents) filter (where p.kind in ('refund', 'deposit_refund')), 0)::bigint,
           coalesce(sum(case when p.kind in ('payment', 'deposit') then p.amount_cents else -p.amount_cents end), 0)::bigint,
           count(*)
    from payments p
    where p.shop_id = c.shop_id and p.method is not null and p.received_date between p_from and p_to
    group by p.method order by p.method;
end $$;

-- ───────── Cash drawer days ─────────
create or replace function public.report_cash(p_from date, p_to date)
returns table (session_id uuid, opened_at timestamptz, opened_by text, open_counted_cents bigint, open_difference_cents bigint,
               closed_at timestamptz, closed_by text, close_expected_cents bigint, close_counted_cents bigint, over_short_cents bigint, note text)
language plpgsql stable security definer set search_path = public as $$
declare c record; tz text;
begin
  select * into c from private.ctx(array['owner', 'manager']::staff_role[]);
  perform private.check_range(p_from, p_to);
  select coalesce(timezone, 'America/Toronto') into tz from shops where id = c.shop_id;
  return query
    select s.id, s.opened_at, so.full_name, s.open_counted_cents, s.open_counted_cents - s.open_expected_cents,
           s.closed_at, sc.full_name, s.close_expected_cents, s.close_counted_cents, s.over_short_cents, s.note
    from cash_sessions s
    left join staff so on so.id = s.opened_by
    left join staff sc on sc.id = s.closed_by
    where s.shop_id = c.shop_id and (s.opened_at at time zone tz)::date between p_from and p_to
    order by s.opened_at;
end $$;

-- ───────── Expenses list ─────────
create or replace function public.report_expenses(p_from date, p_to date)
returns table (expense_id uuid, expense_date date, vendor text, category text, total_cents bigint, hst_cents bigint, claim_itc boolean,
               has_receipt boolean, paid_from text, ticket_number int, voided boolean, note text)
language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from private.ctx(array['owner', 'manager']::staff_role[]);
  perform private.check_range(p_from, p_to);
  return query
    select x.id, x.expense_date, x.vendor, a.name, x.total_cents, x.hst_cents, x.claim_itc, x.has_receipt, x.paid_from,
           t.number, x.voided_at is not null, x.note
    from expenses x join accounts a on a.id = x.account_id left join tickets t on t.id = x.ticket_id
    where x.shop_id = c.shop_id and x.expense_date between p_from and p_to
    order by x.expense_date desc, x.created_at desc;
end $$;

-- ───────── Profit per repair ticket ─────────
-- Revenue = what we charged (before tax, after discounts and credits); costs = parts typed on the invoice
-- + outsourced repair bills linked to the ticket.
create or replace function public.report_ticket_profit(p_from date, p_to date)
returns table (ticket_id uuid, ticket_number int, customer text, device text, revenue_cents bigint, parts_cents bigint,
               outsourced_cents bigint, profit_cents bigint)
language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from private.ctx(array['owner', 'manager']::staff_role[]);
  perform private.check_range(p_from, p_to);
  return query
    with inv as (
      select i.ticket_id,
             sum(ii.net_cents - (ii.credited_gross_cents - ii.credited_discount_cents))::bigint as revenue,
             sum(ii.unit_cost_cents * (ii.qty - ii.credited_qty))::bigint as parts
      from invoices i join invoice_items ii on ii.invoice_id = i.id
      where i.shop_id = c.shop_id and i.ticket_id is not null and i.voided_at is null and i.issue_date between p_from and p_to
      group by i.ticket_id
    ), outs as (
      select x.ticket_id, sum(x.total_cents - case when x.claim_itc then x.hst_cents else 0 end)::bigint as cost
      from expenses x
      where x.shop_id = c.shop_id and x.ticket_id is not null and x.voided_at is null
      group by x.ticket_id
    )
    select t.id, t.number,
           coalesce(nullif(btrim(coalesce(cu.first_name, '') || ' ' || coalesce(cu.last_name, '')), ''), cu.company, ''),
           btrim(coalesce(t.brand, '') || ' ' || coalesce(t.model, t.device_type)),
           inv.revenue, inv.parts, coalesce(outs.cost, 0)::bigint, (inv.revenue - inv.parts - coalesce(outs.cost, 0))::bigint
    from inv join tickets t on t.id = inv.ticket_id
    left join customers cu on cu.id = t.customer_id
    left join outs on outs.ticket_id = t.id
    order by t.number desc;
end $$;

-- ───────── Everything the home page needs, in one call ─────────
-- Sales (before tax), costs, net profit, money in by method, HST owed, invoice status, and a per-day
-- (or per-month for long ranges) series of sales and costs for the chart.
create or replace function public.dashboard_money(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record; sales bigint; costs bigint; hst_c bigint; hst_i bigint; byday jsonb; methods jsonb; inv_status jsonb; monthly boolean;
begin
  select * into c from private.ctx(array['owner', 'manager']::staff_role[]);
  perform private.check_range(p_from, p_to);
  select coalesce(sum(case when type = 'income' then (case when system_key = 'discounts' then -amount_cents else amount_cents end) else 0 end), 0),
         coalesce(sum(case when type = 'expense' then amount_cents else 0 end), 0),
         coalesce(sum(case when system_key = 'hst_collected' then amount_cents else 0 end), 0),
         coalesce(sum(case when system_key = 'hst_itc' then amount_cents else 0 end), 0)
  into sales, costs, hst_c, hst_i
  from private.account_movements(c.shop_id, p_from, p_to);

  monthly := p_to - p_from > 62;
  select coalesce(jsonb_agg(jsonb_build_object('date', d.bucket, 'sales_cents', coalesce(v.sales, 0), 'costs_cents', coalesce(v.costs, 0)) order by d.bucket), '[]')
  into byday
  from (select distinct (case when monthly then date_trunc('month', g)::date else g::date end) as bucket
        from generate_series(p_from, p_to, interval '1 day') g) d
  left join (
    select (case when monthly then date_trunc('month', je.entry_date)::date else je.entry_date end) as bucket,
           sum(case when a.type = 'income' then jl.credit_cents - jl.debit_cents else 0 end)::bigint as sales,
           sum(case when a.type = 'expense' then jl.debit_cents - jl.credit_cents else 0 end)::bigint as costs
    from journal_lines jl join journal_entries je on je.id = jl.entry_id join accounts a on a.id = jl.account_id
    where jl.shop_id = c.shop_id and je.entry_date between p_from and p_to and a.type in ('income', 'expense')
    group by 1
  ) v on v.bucket = d.bucket;

  select coalesce(jsonb_object_agg(method, net), '{}') into methods from (
    select p.method::text as method, sum(case when p.kind in ('payment', 'deposit') then p.amount_cents else -p.amount_cents end)::bigint as net
    from payments p where p.shop_id = c.shop_id and p.method is not null and p.received_date between p_from and p_to group by p.method
  ) m;

  -- Invoice status right now (not limited to the period): what's open, what's overdue (30+ days), paid in period.
  select jsonb_build_object(
    'open_count', count(*) filter (where status in ('unpaid', 'partial')),
    'open_cents', coalesce(sum(total_cents - paid_cents - credited_cents) filter (where status in ('unpaid', 'partial')), 0),
    'overdue_count', count(*) filter (where status in ('unpaid', 'partial') and private.shop_today(c.shop_id) - issue_date > 30),
    'overdue_cents', coalesce(sum(total_cents - paid_cents - credited_cents) filter (where status in ('unpaid', 'partial') and private.shop_today(c.shop_id) - issue_date > 30), 0),
    'paid_count', count(*) filter (where status = 'paid' and issue_date between p_from and p_to),
    'paid_cents', coalesce(sum(total_cents) filter (where status = 'paid' and issue_date between p_from and p_to), 0))
  into inv_status from invoices where shop_id = c.shop_id;

  return jsonb_build_object(
    'sales_cents', sales, 'costs_cents', costs, 'net_profit_cents', sales - costs,
    'hst_collected_cents', hst_c, 'hst_itc_cents', hst_i, 'hst_owing_cents', hst_c - hst_i,
    'money_in', methods, 'invoices', inv_status, 'series', byday, 'series_by', case when monthly then 'month' else 'day' end);
end $$;

-- Today's date in the shop's time zone, so the app never guesses.
create or replace function public.shop_today() returns date language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  select * into c from private.ctx(array['owner', 'manager', 'front_desk', 'technician']::staff_role[]);
  return private.shop_today(c.shop_id);
end $$;

revoke all on all functions in schema private from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['report_pnl(date,date)', 'report_balance_sheet(date)', 'report_hst(date,date)', 'report_ar_aging(date)',
    'report_payments(date,date)', 'report_cash(date,date)', 'report_expenses(date,date)', 'report_ticket_profit(date,date)',
    'dashboard_money(date,date)', 'shop_today()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
