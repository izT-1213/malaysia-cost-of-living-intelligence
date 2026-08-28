-- Compact premise-level prices for custom basket comparisons.

create table if not exists public.daily_item_premise_summary (
    metric_date date not null,
    premise_code integer not null,
    item_code integer not null,
    min_price numeric(12, 2) not null check (min_price > 0),
    median_price numeric(12, 2) not null check (median_price > 0),
    max_price numeric(12, 2) not null check (max_price > 0),
    calculated_at timestamptz not null default now(),
    source_snapshot_sha256 text not null,
    primary key (metric_date, premise_code, item_code)
);

create index if not exists daily_item_premise_summary_date_idx
    on public.daily_item_premise_summary (metric_date, premise_code);

alter table public.daily_item_premise_summary enable row level security;

drop policy if exists "Public can read daily item premise summaries" on public.daily_item_premise_summary;
create policy "Public can read daily item premise summaries"
    on public.daily_item_premise_summary for select using (true);
