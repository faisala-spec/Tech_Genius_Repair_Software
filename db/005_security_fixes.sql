-- Run after 002_app_functions.sql. Fixes from the Supabase security advisor.
-- Visitors who are not signed in cannot call internal functions.
revoke execute on function public.next_number(text) from anon, public;
revoke execute on function public.current_shop_id() from anon, public;
grant execute on function public.current_shop_id() to authenticated;
alter function public.touch_updated_at() set search_path = public;
