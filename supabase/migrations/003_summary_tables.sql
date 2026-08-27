-- Compact serving tables for the free-plan dashboard.
-- Raw observations remain an ingestion layer; these tables are the frontend contract.

create table if not exists public.source_snapshots (
    source_name text not null,
    source_month date not null,
    source_url text not null,
    source_snapshot_sha256 text not null,
    rows_seen integer,
    retrieved_at timestamptz not null default now(),
    primary key (source_name, source_month, source_snapshot_sha256)
);

create table if not exists public.daily_item_area_summary (
    metric_date date not null,
    area_level text not null check (area_level in ('state', 'district')),
    state text not null,
    district text not null default '',
    item_code integer not null,
    min_price numeric(12, 2) not null check (min_price > 0),
    median_price numeric(12, 2) not null check (median_price > 0),
    max_price numeric(12, 2) not null check (max_price > 0),
    min_premise_code integer,
    max_premise_code integer,
    calculated_at timestamptz not null default now(),
    source_snapshot_sha256 text not null,
    primary key (metric_date, state, district, item_code)
);

create index if not exists daily_item_area_summary_item_date_idx
    on public.daily_item_area_summary (item_code, metric_date);
create index if not exists daily_item_area_summary_area_date_idx
    on public.daily_item_area_summary (state, district, metric_date);

create table if not exists public.monthly_item_area_summary (
    metric_month date not null,
    area_level text not null check (area_level in ('state', 'district')),
    state text not null,
    district text not null default '',
    item_code integer not null,
    min_price numeric(12, 2) not null check (min_price > 0),
    median_price numeric(12, 2) not null check (median_price > 0),
    max_price numeric(12, 2) not null check (max_price > 0),
    min_premise_code integer,
    max_premise_code integer,
    calculated_at timestamptz not null default now(),
    source_snapshot_sha256 text not null,
    primary key (metric_month, state, district, item_code)
);

create index if not exists monthly_item_area_summary_item_month_idx
    on public.monthly_item_area_summary (item_code, metric_month);
create index if not exists monthly_item_area_summary_area_month_idx
    on public.monthly_item_area_summary (state, district, metric_month);

create table if not exists public.monthly_category_summary (
    metric_month date not null,
    item_category text not null,
    median_item_change_pct numeric(12, 4),
    items_observed integer not null check (items_observed >= 0),
    items_with_increase integer not null check (items_with_increase >= 0),
    items_with_decrease integer not null check (items_with_decrease >= 0),
    calculated_at timestamptz not null default now(),
    source_snapshot_sha256 text not null,
    primary key (metric_month, item_category)
);

alter table public.source_snapshots enable row level security;
alter table public.daily_item_area_summary enable row level security;
alter table public.monthly_item_area_summary enable row level security;
alter table public.monthly_category_summary enable row level security;

drop policy if exists "Public can read source snapshots" on public.source_snapshots;
create policy "Public can read source snapshots"
    on public.source_snapshots for select using (true);

drop policy if exists "Public can read daily item area summaries" on public.daily_item_area_summary;
create policy "Public can read daily item area summaries"
    on public.daily_item_area_summary for select using (true);

drop policy if exists "Public can read monthly item area summaries" on public.monthly_item_area_summary;
create policy "Public can read monthly item area summaries"
    on public.monthly_item_area_summary for select using (true);

drop policy if exists "Public can read monthly category summaries" on public.monthly_category_summary;
create policy "Public can read monthly category summaries"
    on public.monthly_category_summary for select using (true);
