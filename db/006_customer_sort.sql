-- Run after 005. Lets the customer list sort "newest first" correctly:
-- new customers (no RepairDesk code) first, then imported ones by RepairDesk number, highest first.
alter table public.customers
  add column legacy_num int generated always as (nullif(regexp_replace(coalesce(legacy_code, ''), '\D', '', 'g'), '')::int) stored;
create index customers_newest_idx on public.customers (shop_id, legacy_num desc nulls first, created_at desc);
create index customers_name_idx on public.customers (shop_id, lower(first_name), lower(last_name));
