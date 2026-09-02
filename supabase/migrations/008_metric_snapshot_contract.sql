-- Shared identity proving Dashboard and AI Insights use the same metric snapshot.
alter table public.daily_basket_summary
    add column if not exists metric_snapshot_id text;

create index if not exists daily_basket_summary_snapshot_idx
    on public.daily_basket_summary (metric_snapshot_id);
