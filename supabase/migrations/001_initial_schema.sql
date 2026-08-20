-- Core storage for Malaysia Cost of Living Intelligence.
-- Run this migration in the Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.item_lookup (
    item_code integer primary key,
    item text not null,
    unit text,
    item_group text,
    item_category text,
    source_updated_at timestamptz,
    loaded_at timestamptz not null default now()
);

create table if not exists public.premise_lookup (
    premise_code integer primary key,
    premise text,
    address text,
    premise_type text,
    state text,
    district text,
    source_updated_at timestamptz,
    loaded_at timestamptz not null default now()
);

create table if not exists public.price_observations (
    observation_key text primary key,
    observed_date date not null,
    premise_code integer not null references public.premise_lookup(premise_code),
    item_code integer not null references public.item_lookup(item_code),
    price numeric(12, 2) not null check (price > 0),
    source_month date not null,
    source_snapshot_sha256 text not null,
    ingested_at timestamptz not null default now()
);

create index if not exists price_observations_date_idx
    on public.price_observations (observed_date);
create index if not exists price_observations_item_date_idx
    on public.price_observations (item_code, observed_date);
create index if not exists price_observations_premise_date_idx
    on public.price_observations (premise_code, observed_date);

create table if not exists public.pipeline_runs (
    run_id uuid primary key default gen_random_uuid(),
    source_name text not null,
    source_month date not null,
    source_url text not null,
    source_snapshot_sha256 text not null,
    status text not null check (status in ('started', 'succeeded', 'failed')),
    rows_seen integer,
    rows_loaded integer,
    error_message text,
    started_at timestamptz not null default now(),
    finished_at timestamptz
);

create table if not exists public.daily_metrics (
    metric_date date not null,
    metric_name text not null,
    dimensions jsonb not null default '{}'::jsonb,
    metric_value numeric,
    sample_size integer,
    calculated_at timestamptz not null default now(),
    primary key (metric_date, metric_name, dimensions)
);

create table if not exists public.ai_insights (
    insight_date date primary key,
    insight_type text not null,
    analytical_payload jsonb not null,
    generated_text text not null default '',
    provider text not null default 'disabled',
    model text,
    generated_at timestamptz not null default now()
);

-- Keep raw observations and pipeline metadata private by default.
alter table public.item_lookup enable row level security;
alter table public.premise_lookup enable row level security;
alter table public.price_observations enable row level security;
alter table public.pipeline_runs enable row level security;
alter table public.daily_metrics enable row level security;
alter table public.ai_insights enable row level security;

drop policy if exists "Public can read item lookup" on public.item_lookup;
create policy "Public can read item lookup"
    on public.item_lookup for select using (true);

drop policy if exists "Public can read premise lookup" on public.premise_lookup;
create policy "Public can read premise lookup"
    on public.premise_lookup for select using (true);

drop policy if exists "Public can read daily metrics" on public.daily_metrics;
create policy "Public can read daily metrics"
    on public.daily_metrics for select using (true);

drop policy if exists "Public can read AI insights" on public.ai_insights;
create policy "Public can read AI insights"
    on public.ai_insights for select using (true);
