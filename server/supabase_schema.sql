create table if not exists public.shupi_runtime_state (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.shupi_runtime_state enable row level security;
revoke all on table public.shupi_runtime_state from anon, authenticated;
grant select, insert, update, delete on table public.shupi_runtime_state to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-photos',
  'user-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Product database for the first Shupi catalog. Flutter JSON uses camelCase;
-- the server/provider layer maps it to these conventional SQL column names.
create table if not exists public.products (
  id text primary key,
  brand text not null,
  name text not null,
  category text not null,
  image_url text not null,
  price numeric(12, 2) not null check (price >= 0),
  color text not null,
  size text not null,
  material text not null,
  season text not null,
  style text not null,
  purchase_url text not null default '',
  is_available boolean not null default true,
  sku text unique,
  stock integer not null default 0 check (stock >= 0),
  source_provider text not null default 'mock',
  affiliate_channel_id text,
  commission_rate numeric(6, 5) not null default 0
    check (commission_rate >= 0 and commission_rate <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_available_category_idx
  on public.products (is_available, category);
create index if not exists products_brand_idx on public.products (brand);
create index if not exists products_style_season_idx
  on public.products (style, season);

alter table public.products enable row level security;
revoke all on table public.products from anon, authenticated;
grant select, insert, update, delete on table public.products to service_role;
