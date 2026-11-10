-- Run this once in the Supabase SQL editor AFTER adding the four users
-- (Authentication → Users → Add user). Replace the emails with the real ones.

update public.profiles p set name = 'TJ',     role = 'admin' from auth.users u where u.id = p.id and u.email = 'tushar@myloan.ca';
update public.profiles p set name = 'Sam',    role = 'lead'  from auth.users u where u.id = p.id and u.email = 'sam@myloan.ca';
update public.profiles p set name = 'Corbin', role = 'agent' from auth.users u where u.id = p.id and u.email = 'corbin@myloan.ca';
update public.profiles p set name = 'Ahmed',  role = 'agent' from auth.users u where u.id = p.id and u.email = 'ahmad@myloan.ca';

select name, role from public.profiles order by role, name;
