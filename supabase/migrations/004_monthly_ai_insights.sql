-- Allow one daily and one monthly insight for the same calendar date.
alter table public.ai_insights drop constraint if exists ai_insights_pkey;
alter table public.ai_insights
    add constraint ai_insights_pkey primary key (insight_date, insight_type);
