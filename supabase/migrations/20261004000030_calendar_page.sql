-- Calendar page: counselling, mock interviews, follow-ups and batch starts. Every role can open it;
-- each sees only the events its other pages already allow (row security on the source tables).
insert into public.page (id, grp, title, sort) values ('calendar', 'Home', 'Calendar', 2) on conflict (id) do nothing;
insert into public.role_page_access (role, page_id, mode)
select name, 'calendar', 'r' from public.app_role where name <> 'Admin' on conflict do nothing;
