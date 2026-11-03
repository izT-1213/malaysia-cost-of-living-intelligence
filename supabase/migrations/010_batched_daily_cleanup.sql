-- Delete retention rows in one bounded batch per call so large premise-level
-- tables do not exceed the Postgres statement timeout used by the daily workflow.

drop function if exists public.cleanup_daily_tables_before(date, integer);

create or replace function public.cleanup_daily_tables_before(
    p_cutoff date,
    p_table_name text,
    p_batch_size integer default 5000
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    deleted_count bigint;
begin
    if p_batch_size < 1 or p_batch_size > 50000 then
        raise exception 'p_batch_size must be between 1 and 50000';
    end if;

    if p_table_name not in (
        'daily_item_area_summary',
        'daily_item_premise_summary',
        'daily_basket_summary',
        'price_observations'
    ) then
        raise exception 'unsupported cleanup table: %', p_table_name;
    end if;

    execute format(
        'delete from %I where ctid in (' ||
        'select ctid from %I where %I < $1 limit $2)',
        p_table_name,
        p_table_name,
        case when p_table_name = 'price_observations'
            then 'observed_date' else 'metric_date' end
    ) using p_cutoff, p_batch_size;

    get diagnostics deleted_count = row_count;
    return deleted_count;
end;
$$;

revoke all on function public.cleanup_daily_tables_before(date, text, integer) from public;
grant execute on function public.cleanup_daily_tables_before(date, text, integer) to service_role;
