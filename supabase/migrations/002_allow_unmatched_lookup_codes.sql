-- PriceCatcher can contain newer item codes than the published item lookup.
-- Keep the source observation even when enrichment is temporarily unavailable.
alter table if exists public.price_observations
    drop constraint if exists price_observations_item_code_fkey;

alter table if exists public.price_observations
    drop constraint if exists price_observations_premise_code_fkey;
