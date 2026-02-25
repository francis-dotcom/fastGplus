-- Run this in Supabase Dashboard → SQL Editor to create the fees table and seed it.
-- Fees are read by the fees page to populate the dropdown and fee summary.

create table if not exists public.fees (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  key text not null unique,
  label text not null,
  base_label text not null,
  base_amount numeric(12, 2) not null default 0,
  processing_fee numeric(12, 2) not null default 0,
  installment_count int2 not null default 0,
  sort_order int2 not null default 0
);

alter table public.fees enable row level security;

-- Allow anyone to read fees (needed for the public fees page).
create policy "Allow public read"
  on public.fees
  for select
  to anon
  using (true);

-- Optional: restrict insert/update/delete to authenticated users or service role.
-- For now we don't create insert/update policies so only dashboard/SQL can change data.

-- Seed the four fee types (run once; safe to re-run due to conflict handling).
insert into public.fees (key, label, base_label, base_amount, processing_fee, installment_count, sort_order)
values
  ('tuition', 'Tuition Fees (Fall 2024)', 'Base Tuition', 4200.00, 25.50, 3, 10),
  ('tech', 'Technology & Resource Fee', 'Technology & Resource Fee', 150.00, 2.50, 0, 20),
  ('application', 'Application Fee', 'Application Fee', 75.00, 2.50, 0, 30),
  ('library', 'Library Fines / Misc', 'Library / Misc', 0.00, 0.00, 0, 40)
on conflict (key) do update set
  label = excluded.label,
  base_label = excluded.base_label,
  base_amount = excluded.base_amount,
  processing_fee = excluded.processing_fee,
  installment_count = excluded.installment_count,
  sort_order = excluded.sort_order;
