alter table public.catalog_items
  add column if not exists source_label text not null default '';

alter table public.catalog_items
  alter column end_date type timestamptz
  using case
    when end_date is null then null
    else (end_date::text || 'T23:59:59.999Z')::timestamptz
  end;
