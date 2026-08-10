alter table public.profiles
  add column if not exists app_role text not null default 'member';

alter table public.profiles
  drop constraint if exists profiles_app_role_check;
alter table public.profiles
  add constraint profiles_app_role_check check (app_role in ('member', 'admin'));

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  subtype text,
  status text not null default 'draft',
  visibility text not null default 'public',
  translations jsonb not null default '{}'::jsonb,
  organization text not null default '',
  location text not null default '',
  topics text[] not null default '{}'::text[],
  starts_at timestamptz,
  deadline_at timestamptz,
  end_date date,
  source_url text not null default '',
  source_verified_at timestamptz,
  action_mode text not null default 'none',
  action_url text not null default '',
  featured boolean not null default false,
  version integer not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_items_kind_check check (kind in ('opportunity', 'project', 'learning_circle', 'resource', 'case_study')),
  constraint catalog_items_subtype_check check (subtype is null or subtype in ('job', 'consulting', 'grant', 'open_call', 'fellowship', 'other')),
  constraint catalog_items_status_check check (status in ('draft', 'published', 'archived')),
  constraint catalog_items_visibility_check check (visibility in ('public', 'members')),
  constraint catalog_items_action_mode_check check (action_mode in ('external', 'interest', 'none')),
  constraint catalog_items_version_check check (version > 0)
);

create table if not exists public.catalog_interests (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null default '',
  status text not null default 'new',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  unique (user_id, item_id),
  constraint catalog_interests_status_check check (status in ('new', 'contacted', 'closed', 'withdrawn')),
  constraint catalog_interests_version_check check (version > 0),
  constraint catalog_interests_message_length_check check (char_length(message) <= 1000)
);

create index if not exists catalog_items_listing_idx
  on public.catalog_items(status, visibility, featured desc, deadline_at asc nulls last, published_at desc, id asc);
create index if not exists catalog_items_created_by_idx on public.catalog_items(created_by);
create index if not exists catalog_items_updated_by_idx on public.catalog_items(updated_by);
create index if not exists catalog_items_published_by_idx on public.catalog_items(published_by);
create index if not exists catalog_interests_item_id_idx on public.catalog_interests(item_id);
create index if not exists catalog_interests_user_id_idx on public.catalog_interests(user_id, updated_at desc, id asc);
create index if not exists catalog_interests_queue_idx on public.catalog_interests(status, updated_at asc, id asc);
create index if not exists catalog_interests_updated_by_idx on public.catalog_interests(updated_by);

drop trigger if exists catalog_items_updated_at on public.catalog_items;
create trigger catalog_items_updated_at
before update on public.catalog_items
for each row execute function public.set_updated_at();

drop trigger if exists catalog_interests_updated_at on public.catalog_interests;
create trigger catalog_interests_updated_at
before update on public.catalog_interests
for each row execute function public.set_updated_at();

alter table public.catalog_items enable row level security;
alter table public.catalog_interests enable row level security;

revoke all on table public.catalog_items from anon, authenticated;
revoke all on table public.catalog_interests from anon, authenticated;
grant all on table public.catalog_items to service_role;
grant all on table public.catalog_interests to service_role;

drop policy if exists "catalog_items_deny_browser" on public.catalog_items;
create policy "catalog_items_deny_browser"
on public.catalog_items for all to anon, authenticated
using (false) with check (false);

drop policy if exists "catalog_interests_deny_browser" on public.catalog_interests;
create policy "catalog_interests_deny_browser"
on public.catalog_interests for all to anon, authenticated
using (false) with check (false);
