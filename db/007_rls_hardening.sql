-- 007: permissions by ROLE, not just by shop.
-- Before this, every table had one "FOR ALL" policy that only checked shop_id, and Supabase grants
-- ALL on public tables to every signed-in user. So any staff member (even a technician) could, from the
-- browser, make themselves owner, change the tax rate, or edit money rows. Tests: test/db/rls.test.ts.
--
-- Money tables (invoices, invoice_items, payments) are rebuilt with the ledger in 008 and get their
-- rules there.

-- ───────── Who is calling ─────────
create or replace function public.current_staff_role() returns staff_role
language sql stable security definer set search_path = public as $$
  select role from staff where auth_user_id = auth.uid() and active
$$;

create or replace function public.current_staff_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from staff where auth_user_id = auth.uid() and active
$$;

revoke all on function public.current_staff_role() from public, anon;
revoke all on function public.current_staff_id() from public, anon;
grant execute on function public.current_staff_role() to authenticated;
grant execute on function public.current_staff_id() to authenticated;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_staff_role() in ('owner', 'manager'), false)
$$;
revoke all on function public.is_manager() from public, anon;
grant execute on function public.is_manager() to authenticated;

-- ───────── Signed-out visitors get nothing, ever ─────────
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

-- ───────── Drop the old "anything in my shop" policies ─────────
do $$
declare t text;
begin
  foreach t in array array['staff','customers','tickets','ticket_photos','ticket_events','products','stock_moves','messages','audit_log']
  loop
    execute format('drop policy if exists shop_isolation on %I', t);
  end loop;
end $$;
drop policy if exists own_shop on shops;

-- ───────── shops: everyone reads their own; only the owner edits safe fields ─────────
revoke insert, update, delete, truncate on shops from authenticated;
grant update (name, legal_name, phone, email, address, city, province, country, timezone,
              tax_name, tax_rate, tax_number, logo_url, brand_color, ticket_prefix, invoice_terms,
              repair_warranty_days, device_warranty_days, sms_number, ai_call_start, ai_call_end,
              review_link, review_delay_minutes)
  on shops to authenticated;
create policy shops_select on shops for select to authenticated using (id = current_shop_id());
create policy shops_update on shops for update to authenticated
  using (id = current_shop_id() and current_staff_role() = 'owner')
  with check (id = current_shop_id() and current_staff_role() = 'owner');

-- ───────── staff: everyone sees colleagues; only the owner manages staff ─────────
revoke truncate on staff from authenticated;
alter table staff alter column shop_id set default current_shop_id();
create policy staff_select on staff for select to authenticated using (shop_id = current_shop_id());
create policy staff_insert on staff for insert to authenticated
  with check (shop_id = current_shop_id() and current_staff_role() = 'owner');
-- The owner can't demote or deactivate themselves (that would lock the shop out).
create policy staff_update on staff for update to authenticated
  using (shop_id = current_shop_id() and current_staff_role() = 'owner')
  with check (shop_id = current_shop_id() and (auth_user_id is distinct from auth.uid() or (role = 'owner' and active)));
create policy staff_delete on staff for delete to authenticated
  using (shop_id = current_shop_id() and current_staff_role() = 'owner' and auth_user_id is distinct from auth.uid());
-- Column-level: a table-wide UPDATE grant would override column revokes, so grant only the safe columns.
-- (No pin_hash or shop_id edits from the browser.)
revoke update on staff from authenticated;
grant update (full_name, email, role, pay_per_repair_pct, active, auth_user_id) on staff to authenticated;

-- ───────── customers: all staff read/add/edit; only owner/manager delete ─────────
revoke truncate on customers from authenticated;
create policy customers_select on customers for select to authenticated using (shop_id = current_shop_id());
create policy customers_insert on customers for insert to authenticated with check (shop_id = current_shop_id());
create policy customers_update on customers for update to authenticated
  using (shop_id = current_shop_id()) with check (shop_id = current_shop_id());
create policy customers_delete on customers for delete to authenticated using (shop_id = current_shop_id() and is_manager());

-- ───────── tickets: all staff work on them; never deleted (cancel instead) ─────────
revoke delete, truncate on tickets from authenticated;
create policy tickets_select on tickets for select to authenticated using (shop_id = current_shop_id());
create policy tickets_insert on tickets for insert to authenticated with check (shop_id = current_shop_id());
create policy tickets_update on tickets for update to authenticated
  using (shop_id = current_shop_id()) with check (shop_id = current_shop_id());
-- Ticket numbers come from next_number(); nobody renumbers a ticket or moves it to another shop.
revoke update on tickets from authenticated;
grant update (legacy_number, customer_id, device_type, brand, model, imei_serial, color, problem,
              condition_notes, passcode_enc, accessories, estimate, deposit, status, technician_id,
              due_at, signature_url, warranty_until, updated_at, picked_up_at)
  on tickets to authenticated;

-- ───────── ticket history: add only, never edit or delete; written as yourself ─────────
revoke update, delete, truncate on ticket_events from authenticated;
create policy ticket_events_select on ticket_events for select to authenticated using (shop_id = current_shop_id());
create policy ticket_events_insert on ticket_events for insert to authenticated
  with check (shop_id = current_shop_id() and (staff_id is null or staff_id = current_staff_id()));

revoke update, truncate on ticket_photos from authenticated;
create policy ticket_photos_select on ticket_photos for select to authenticated using (shop_id = current_shop_id());
create policy ticket_photos_insert on ticket_photos for insert to authenticated with check (shop_id = current_shop_id());
create policy ticket_photos_delete on ticket_photos for delete to authenticated using (shop_id = current_shop_id() and is_manager());

-- ───────── texts/calls log: add only ─────────
revoke update, delete, truncate on messages from authenticated;
create policy messages_select on messages for select to authenticated using (shop_id = current_shop_id());
create policy messages_insert on messages for insert to authenticated with check (shop_id = current_shop_id());

-- ───────── products / stock: everyone reads; owner/manager change; stock moves are history ─────────
revoke truncate on products from authenticated;
create policy products_select on products for select to authenticated using (shop_id = current_shop_id());
create policy products_insert on products for insert to authenticated with check (shop_id = current_shop_id() and is_manager());
create policy products_update on products for update to authenticated
  using (shop_id = current_shop_id() and is_manager()) with check (shop_id = current_shop_id() and is_manager());
create policy products_delete on products for delete to authenticated using (shop_id = current_shop_id() and is_manager());

revoke update, delete, truncate on stock_moves from authenticated;
create policy stock_moves_select on stock_moves for select to authenticated using (shop_id = current_shop_id());
create policy stock_moves_insert on stock_moves for insert to authenticated with check (shop_id = current_shop_id() and is_manager());

-- ───────── audit log: owner/manager read it; only database functions write it ─────────
revoke insert, update, delete, truncate on audit_log from authenticated;
revoke all on sequence audit_log_id_seq from authenticated;
create policy audit_log_select on audit_log for select to authenticated using (shop_id = current_shop_id() and is_manager());

-- Nothing may ever change or remove an audit row, not even an admin by mistake.
create or replace function public.block_change() returns trigger language plpgsql set search_path = public as $$
begin
  raise exception '% rows can''t be changed or deleted', tg_table_name;
end $$;
revoke all on function public.block_change() from public, authenticated;
create trigger audit_log_immutable before update or delete on audit_log for each row execute function block_change();
create trigger audit_log_no_truncate before truncate on audit_log for each statement execute function block_change();
