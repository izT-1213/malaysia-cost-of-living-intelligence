-- Delete retention rows in bounded batches so large premise-level dates do not
-- exceed the Postgres statement timeout used by the daily workflow.

create or replace function public.cleanup_daily_tables_before(
    p_cutoff date,
    p_batch_size integer default 5000
)
returns table (table_name text, rows_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
    target record;
    deleted_count bigint;
begin
    if p_batch_size < 1 or p_batch_size > 50000 then
        raise exception 'p_batch_size must be between 1 and 50000';
    end if;

    for target in
        select * from (values
            ('daily_item_area_summary'::text, 'metric_date'::text),
            ('daily_item_premise_summary'::text, 'metric_date'::text),
            ('daily_basket_summary'::text, 'metric_date'::text),
            ('price_observations'::text, 'observed_date'::text)
        ) as tables_to_clean(table_name, date_column)
    loop
        loop
            execute format(
                'delete from %I where ctid in (' ||
                'select ctid from %I where %I < $1 limit $2)',
                target.table_name,
                target.table_name,
                target.date_column
            ) using p_cutoff, p_batch_size;

            get diagnostics deleted_count = row_count;
            exit when deleted_count = 0;

            table_name := target.table_name;
            rows_deleted := deleted_count;
            return next;
        end loop;
    end loop;
end;
$$;

revoke all on function public.cleanup_daily_tables_before(date, integer) from public;
grant execute on function public.cleanup_daily_tables_before(date, integer) to service_role;
