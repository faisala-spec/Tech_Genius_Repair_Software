-- Run after schema.sql and seed_techgenius.sql.

-- 1. The app never sends shop_id: the database fills it from the signed-in staff member.
do $$
declare t text;
begin
  foreach t in array array['customers','tickets','ticket_photos','ticket_events','products',
                           'stock_moves','invoices','invoice_items','payments','messages','audit_log']
  loop
    execute format('alter table %I alter column shop_id set default current_shop_id()', t);
  end loop;
end $$;

-- 2. Ticket and invoice numbers: handed out one at a time, never duplicated.
create or replace function next_number(kind text) returns int
language plpgsql security definer set search_path = public as $$
declare
  n   int;
  sid uuid := current_shop_id();
begin
  if sid is null then
    raise exception 'not signed in as staff';
  end if;
  if kind = 'ticket' then
    update shops set next_ticket_number = next_ticket_number + 1
      where id = sid returning next_ticket_number - 1 into n;
  elsif kind = 'invoice' then
    update shops set next_invoice_number = next_invoice_number + 1
      where id = sid returning next_invoice_number - 1 into n;
  else
    raise exception 'unknown number kind %', kind;
  end if;
  return n;
end $$;

revoke all on function next_number(text) from public;
grant execute on function next_number(text) to authenticated;

-- 3. Keep updated_at fresh.
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger customers_touch before update on customers for each row execute function touch_updated_at();
create trigger tickets_touch   before update on tickets   for each row execute function touch_updated_at();
