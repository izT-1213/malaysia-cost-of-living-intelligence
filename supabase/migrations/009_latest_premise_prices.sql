-- One latest observed price per premise and item for compact premise analysis.
create table if not exists public.premise_item_latest (
    premise_code integer not null,
    item_code integer not null,
    price numeric(12, 2) not null check (price > 0),
    observed_date date not null,
    price_age_days integer not null check (price_age_days >= 0),
    source_snapshot_sha256 text not null,
    calculated_at timestamptz not null default now(),
    primary key (premise_code, item_code)
);

create index if not exists premise_item_latest_item_idx
    on public.premise_item_latest (item_code);
create index if not exists premise_item_latest_date_idx
    on public.premise_item_latest (observed_date);

alter table public.premise_item_latest enable row level security;

drop policy if exists "Public can read latest premise prices" on public.premise_item_latest;
create policy "Public can read latest premise prices"
    on public.premise_item_latest for select using (true);
