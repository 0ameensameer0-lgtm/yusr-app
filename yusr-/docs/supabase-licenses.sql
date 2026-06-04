create table if not exists licenses (
  code text primary key,
  plan text not null default 'PRO',
  status text not null default 'active',
  expires_at timestamptz not null,
  duration_label text,
  access_mode text not null default 'admin',
  device_id text,
  activated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table licenses add column if not exists access_mode text not null default 'admin';
alter table licenses add column if not exists teacher_slots integer not null default 0;
alter table licenses add column if not exists parent_code text;
alter table licenses add column if not exists permissions jsonb;
alter table licenses add column if not exists owner_name text;

create index if not exists licenses_status_idx on licenses(status);
create index if not exists licenses_device_id_idx on licenses(device_id);

alter table licenses enable row level security;

drop policy if exists "allow app license reads" on licenses;
drop policy if exists "allow app license inserts" on licenses;
drop policy if exists "allow app license updates" on licenses;

create policy "allow app license reads"
on licenses for select
using (true);

create policy "allow app license inserts"
on licenses for insert
with check (true);

create policy "allow app license updates"
on licenses for update
using (true)
with check (true);

create table if not exists admin_settings (
  id text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table admin_settings enable row level security;

drop policy if exists "allow app admin settings reads" on admin_settings;
drop policy if exists "allow app admin settings inserts" on admin_settings;
drop policy if exists "allow app admin settings updates" on admin_settings;

create policy "allow app admin settings reads"
on admin_settings for select
using (true);

create policy "allow app admin settings inserts"
on admin_settings for insert
with check (true);

create policy "allow app admin settings updates"
on admin_settings for update
using (true)
with check (true);

create table if not exists site_views (
  id text primary key,
  device_id text,
  path text,
  created_at timestamptz not null default now()
);

create index if not exists site_views_created_at_idx on site_views(created_at);
create index if not exists site_views_device_id_idx on site_views(device_id);

alter table site_views enable row level security;

drop policy if exists "allow app site view reads" on site_views;
drop policy if exists "allow app site view inserts" on site_views;

create policy "allow app site view reads"
on site_views for select
using (true);

create policy "allow app site view inserts"
on site_views for insert
with check (true);

create table if not exists activation_requests (
  id text primary key,
  customer_name text not null,
  requested_plan text not null,
  requested_label text not null,
  code text not null references licenses(code) on delete cascade,
  status text not null default 'pending',
  access_mode text not null default 'admin',
  approved_duration text,
  approved_label text,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table activation_requests add column if not exists access_mode text not null default 'admin';
alter table activation_requests add column if not exists requested_role text not null default 'teacher';
alter table activation_requests add column if not exists requested_role_label text;
alter table activation_requests add column if not exists teacher_slots integer not null default 0;
alter table activation_requests add column if not exists quoted_price numeric not null default 0;
alter table activation_requests add column if not exists currency text not null default 'SAR';
alter table activation_requests add column if not exists display_price numeric not null default 0;
alter table activation_requests add column if not exists price_label text;
alter table activation_requests add column if not exists payment_attempt integer not null default 1;
alter table activation_requests add column if not exists previous_payment_code text;
alter table activation_requests add column if not exists request_kind text not null default 'activation';

create index if not exists activation_requests_status_idx on activation_requests(status);
create index if not exists activation_requests_created_at_idx on activation_requests(created_at);
create index if not exists activation_requests_payment_attempt_idx on activation_requests(payment_attempt);
create index if not exists activation_requests_request_kind_idx on activation_requests(request_kind);

alter table activation_requests enable row level security;

drop policy if exists "allow app activation request reads" on activation_requests;
drop policy if exists "allow app activation request inserts" on activation_requests;
drop policy if exists "allow app activation request updates" on activation_requests;

create policy "allow app activation request reads"
on activation_requests for select
using (true);

create policy "allow app activation request inserts"
on activation_requests for insert
with check (true);

create policy "allow app activation request updates"
on activation_requests for update
using (true)
with check (true);

create table if not exists managed_account_data (
  code text primary key,
  parent_code text,
  owner_name text,
  access_mode text not null default 'teacher',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table managed_account_data add column if not exists parent_code text;
alter table managed_account_data add column if not exists owner_name text;
alter table managed_account_data add column if not exists access_mode text not null default 'teacher';
alter table managed_account_data add column if not exists data jsonb not null default '{}'::jsonb;
alter table managed_account_data add column if not exists updated_at timestamptz not null default now();

create index if not exists managed_account_data_parent_idx on managed_account_data(parent_code);
create index if not exists managed_account_data_updated_idx on managed_account_data(updated_at);

alter table managed_account_data enable row level security;

drop policy if exists "allow managed account data reads" on managed_account_data;
drop policy if exists "allow managed account data inserts" on managed_account_data;
drop policy if exists "allow managed account data updates" on managed_account_data;

create policy "allow managed account data reads"
on managed_account_data for select
using (true);

create policy "allow managed account data inserts"
on managed_account_data for insert
with check (true);

create policy "allow managed account data updates"
on managed_account_data for update
using (true)
with check (true);
