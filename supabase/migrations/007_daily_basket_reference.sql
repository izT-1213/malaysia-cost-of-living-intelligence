-- Store the already-rounded cross-state reference beside canonical state rows.
alter table public.daily_basket_summary
    add column if not exists cross_state_reference numeric(12, 2);
