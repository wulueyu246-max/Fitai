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
  product_id text not null unique,
  title text not null,
  brand text not null,
  category text not null,
  color text not null,
  size text not null,
  price numeric(12, 2) not null check (price >= 0),
  image_url text not null,
  detail_url text not null default '',
  affiliate_url text not null default '',
  pid text not null default '',
  coupon_url text not null default '',
  stock_status text not null default 'in_stock',
  purchase_url text not null default '',
  platform text not null default 'mock-catalog',
  commission numeric(12, 2) not null default 0 check (commission >= 0),
  tags text[] not null default '{}',
  material text not null,
  season text not null,
  style text not null,
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

-- Compatibility migration for databases created by an earlier Shupi schema.
alter table public.products add column if not exists title text;
alter table public.products add column if not exists product_id text;
alter table public.products add column if not exists detail_url text
  not null default '';
alter table public.products add column if not exists affiliate_url text
  not null default '';
alter table public.products add column if not exists pid text
  not null default '';
alter table public.products add column if not exists coupon_url text
  not null default '';
alter table public.products add column if not exists stock_status text
  not null default 'in_stock';
alter table public.products add column if not exists platform text
  not null default 'mock-catalog';
alter table public.products add column if not exists commission numeric(12, 2)
  not null default 0 check (commission >= 0);
alter table public.products add column if not exists tags text[]
  not null default '{}';
update public.products set title = id where title is null or title = '';
update public.products set product_id = id
  where product_id is null or product_id = '';
update public.products set detail_url = purchase_url
  where detail_url = '' and purchase_url <> '';
update public.products set affiliate_url = purchase_url
  where affiliate_url = '' and purchase_url <> '';
update public.products set stock_status = case
  when stock > 0 and is_available then 'in_stock'
  else 'out_of_stock'
end
where stock_status = '' or stock_status is null;
alter table public.products alter column product_id set not null;
alter table public.products alter column title set not null;

create index if not exists products_available_category_idx
  on public.products (is_available, category);
create index if not exists products_brand_idx on public.products (brand);
create index if not exists products_style_season_idx
  on public.products (style, season);
create index if not exists products_platform_idx
  on public.products (platform);
create index if not exists products_product_id_idx
  on public.products (product_id);
create index if not exists products_tags_idx
  on public.products using gin (tags);

alter table public.products enable row level security;
revoke all on table public.products from anon, authenticated;
grant select, insert, update, delete on table public.products to service_role;

create table if not exists public.product_click_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  product_id text not null,
  platform text not null,
  click_time timestamptz not null default now()
);

create index if not exists product_click_events_product_id_idx
  on public.product_click_events (product_id);
create index if not exists product_click_events_click_time_idx
  on public.product_click_events (click_time desc);

alter table public.product_click_events enable row level security;
revoke all on table public.product_click_events from anon, authenticated;
grant select, insert on table public.product_click_events to service_role;
