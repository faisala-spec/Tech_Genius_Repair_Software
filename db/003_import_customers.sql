-- Customer import from RepairDesk, in two steps.
--
-- STEP A: run this block, then in Supabase → Table Editor → import_customers →
--         "Insert" → "Import data from CSV" and upload customers_clean.csv.
create table if not exists import_customers (
  legacy_code text, first_name text, last_name text, company text, phone text, phone_alt text,
  email text, address text, city text, province text, postal_code text, country text,
  referral_source text, notes text, archived text, legacy_ticket_count text, legacy_lifetime_spend text
);
-- Locked: no one can read this table through the app or the API while it holds customer data.
alter table import_customers enable row level security;


-- STEP B: after the CSV upload, run everything below.
/*
insert into customers (shop_id, legacy_code, first_name, last_name, company, phone, phone_alt, email,
                       address, city, province, postal_code, country, referral_source, notes,
                       archived, legacy_ticket_count, legacy_lifetime_spend)
select (select id from shops where legal_name = 'Tech Genius Burlington Inc.'),
       legacy_code, nullif(first_name,''), nullif(last_name,''), nullif(company,''),
       nullif(phone,''), nullif(phone_alt,''), nullif(email,''), nullif(address,''), nullif(city,''),
       nullif(province,''), nullif(postal_code,''), nullif(country,''), nullif(referral_source,''),
       nullif(notes,''),
       coalesce(archived,'False') = 'True',
       coalesce(nullif(legacy_ticket_count,''),'0')::numeric::int,
       coalesce(nullif(legacy_lifetime_spend,''),'0')::numeric
from import_customers;

-- Must say 9276
select count(*) as customers_imported from customers;

drop table import_customers;
*/
