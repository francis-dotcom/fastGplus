-- Run this in Supabase Dashboard → SQL Editor if the "applications" table doesn't exist yet.
-- Adjust types if you already have a different schema.

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  first_name text,
  last_name text,
  email text not null,
  phone text,
  date_of_birth date,
  permanent_address text,
  faculty text,
  program_applied text,
  study_mode text,
  intake text,
  highest_qualification text,
  institution_name text,
  graduation_year int2,
  gpa text,
  metadata jsonb
);

-- Allow anonymous inserts from the website (optional: tighten with RLS later).
alter table public.applications enable row level security;

create policy "Allow anonymous insert"
  on public.applications
  for insert
  to anon
  with check (true);

-- Optional: only allow authenticated users or your backend to read.
-- create policy "No public read" on public.applications for select using (false);
