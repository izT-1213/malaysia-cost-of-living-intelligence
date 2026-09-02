-- Indexes for the dashboard's date-bounded serving queries.
-- The frontend filters by area level and metric date before ordering rows.

create index if not exists daily_item_area_summary_level_date_idx
    on public.daily_item_area_summary (area_level, metric_date);

create index if not exists monthly_item_area_summary_level_month_idx
    on public.monthly_item_area_summary (area_level, metric_month);
