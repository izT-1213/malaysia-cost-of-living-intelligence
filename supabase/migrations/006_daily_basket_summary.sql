-- Canonical reference-basket totals shared by the dashboard and AI payload.
create table if not exists public.daily_basket_summary (
    metric_date date not null,
    state text not null,
    basket_median numeric(12, 2) not null,
    component_prices jsonb not null default '{}'::jsonb,
    reference_basket_items_observed integer not null,
    reference_basket_items_total integer not null,
    reference_basket_days_observed integer not null,
    source_snapshot_sha256 text not null,
    calculated_at timestamptz not null default now(),
    primary key (metric_date, state)
);

create index if not exists daily_basket_summary_date_idx
    on public.daily_basket_summary (metric_date);

alter table public.daily_basket_summary enable row level security;

drop policy if exists "Public can read daily basket summary" on public.daily_basket_summary;
create policy "Public can read daily basket summary"
    on public.daily_basket_summary for select using (true);
