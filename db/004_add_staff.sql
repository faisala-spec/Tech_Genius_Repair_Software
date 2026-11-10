-- Give someone access to the app.
-- 1. Supabase → Authentication → Users → "Add user" → enter their email and a password.
-- 2. Change the email, name and role below, then run it.
--    Roles: owner, manager, technician, front_desk

insert into staff (shop_id, auth_user_id, full_name, email, role)
select s.id, u.id, 'Faisal Ahmed', u.email, 'owner'
from shops s, auth.users u
where s.legal_name = 'Tech Genius Burlington Inc.'
  and u.email = 'CHANGE-ME@techgenius.ca';
