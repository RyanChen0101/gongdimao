-- 工地貓 資料庫設定
-- 使用方式：Supabase 後台 → SQL Editor → New query → 整份貼上 → Run
-- 可以重複執行，不會清掉既有資料。

-- ============ 資料表 ============

-- 公司成員（對應登入帳號）
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default '設計師',          -- 總監 / 設計師 / 財務
  is_admin boolean not null default false,       -- 只能在後台用 SQL 設定
  created_at timestamptz not null default now()
);

-- 外部師傅、廠商（只是被指派的名字，不能登入）
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trade text not null default '',
  created_at timestamptz not null default now()
);

-- 專案（工地）
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default '',
  address text not null default '',
  client text not null default '',
  pm text not null default '',
  phase text not null default '拆除',
  progress int not null default 0 check (progress between 0 and 100),
  start_date date,
  end_date date,
  today text not null default '',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 工地紀錄（指定負責人的就是待辦）
create table if not exists public.records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  ts timestamptz not null default now(),
  category text not null default '進度',
  text text not null default '',
  photos text[] not null default '{}',           -- Storage 路徑
  assignee text not null default '',
  due date,
  urgent boolean not null default false,
  status text not null default 'open' check (status in ('open','done')),
  done_at timestamptz,
  by_name text not null default '',
  done_by text,                                  -- 誰按下完成（負責人為「全員」時用來算點數）
  created_by uuid default auth.uid() references auth.users(id) on delete set null
);
-- 舊版資料庫補欄位（可重複執行）
alter table public.records add column if not exists done_by text;
-- 採購品項與編輯紀錄（v5）
alter table public.records add column if not exists items jsonb not null default '[]';
alter table public.records add column if not exists vendor text not null default '';
alter table public.records add column if not exists edited_at timestamptz;
alter table public.records add column if not exists edited_by text;
create index if not exists records_project_idx on public.records(project_id);
create index if not exists records_ts_idx on public.records(ts desc);

-- 開工前準備清單（每個專案一份，可自行增減項目）
create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  grp text not null default '其他',
  title text not null,
  sort int not null default 0,
  done boolean not null default false,
  done_by text,
  done_at timestamptz,
  assignee text not null default '',
  due date,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists checklist_project_idx on public.checklist_items(project_id);

-- 團隊貓咪 Yuzu 的造型（全公司共用一筆）
create table if not exists public.team (
  id int primary key default 1 check (id = 1),
  cat jsonb not null default '{}',
  seen jsonb not null default '[]',
  updated_at timestamptz not null default now()
);
insert into public.team (id) values (1) on conflict (id) do nothing;
-- 團隊獎勵（v7）
alter table public.team add column if not exists rewards jsonb not null default '[]';

-- ============ 權限（RLS） ============
-- 原則：只有登入的公司成員看得到、改得了資料；未登入的人什麼都看不到。
-- 刪除專案只限總監（is_admin）。

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.projects enable row level security;
alter table public.records  enable row level security;
alter table public.team     enable row level security;
alter table public.checklist_items enable row level security;

drop policy if exists "成員可讀" on public.profiles;
create policy "成員可讀" on public.profiles for select to authenticated using (true);
drop policy if exists "建立自己的資料" on public.profiles;
create policy "建立自己的資料" on public.profiles for insert to authenticated with check (id = auth.uid() and is_admin = false);
drop policy if exists "修改自己的資料" on public.profiles;
create policy "修改自己的資料" on public.profiles for update to authenticated using (id = auth.uid());
-- 一般成員不能把自己改成總監權限
revoke update on public.profiles from authenticated;
-- 每人各自的 Yuzu 造型（v8）
alter table public.profiles add column if not exists look jsonb;
grant update (name, role, look) on public.profiles to authenticated;

drop policy if exists "成員全權" on public.contacts;
create policy "成員全權" on public.contacts for all to authenticated using (true) with check (true);

drop policy if exists "成員可讀" on public.projects;
create policy "成員可讀" on public.projects for select to authenticated using (true);
drop policy if exists "成員可新增" on public.projects;
create policy "成員可新增" on public.projects for insert to authenticated with check (true);
drop policy if exists "成員可修改" on public.projects;
create policy "成員可修改" on public.projects for update to authenticated using (true) with check (true);
drop policy if exists "總監可刪除" on public.projects;
create policy "總監可刪除" on public.projects for delete to authenticated using (public.is_admin());

drop policy if exists "成員全權" on public.records;
create policy "成員全權" on public.records for all to authenticated using (true) with check (true);

drop policy if exists "成員全權" on public.checklist_items;
create policy "成員全權" on public.checklist_items for all to authenticated using (true) with check (true);

drop policy if exists "成員可讀寫" on public.team;
create policy "成員可讀寫" on public.team for select to authenticated using (true);
drop policy if exists "成員可更新" on public.team;
create policy "成員可更新" on public.team for update to authenticated using (true) with check (true);

-- ============ 照片儲存空間 ============
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "成員可看照片" on storage.objects;
create policy "成員可看照片" on storage.objects for select to authenticated using (bucket_id = 'photos');
drop policy if exists "成員可上傳照片" on storage.objects;
create policy "成員可上傳照片" on storage.objects for insert to authenticated with check (bucket_id = 'photos');
drop policy if exists "成員可刪照片" on storage.objects;
create policy "成員可刪照片" on storage.objects for delete to authenticated using (bucket_id = 'photos');

-- ============ v9：施工經驗庫、增量同步、照片空間 ============
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  what text not null default '',
  fix text not null default '',
  phases text[] not null default '{}',
  trades text[] not null default '{}',
  photos text[] not null default '{}',
  source_record uuid,
  project_id uuid references public.projects(id) on delete set null,
  recur int not null default 0,
  recur_log jsonb not null default '[]',
  by_name text not null default '',
  edited_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.lessons enable row level security;
drop policy if exists "成員全權" on public.lessons;
create policy "成員全權" on public.lessons for all to authenticated using (true) with check (true);

alter table public.records add column if not exists updated_at timestamptz not null default now();
create index if not exists records_updated_idx on public.records(updated_at);
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before update on public.records for each row execute function public.touch_updated_at();

create or replace function public.photo_usage() returns bigint
language sql stable security definer set search_path = public, storage as $$
  select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'photos'
$$;
revoke all on function public.photo_usage() from public, anon;
grant execute on function public.photo_usage() to authenticated;
