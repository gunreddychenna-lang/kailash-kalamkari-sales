-- Apply only to a separately approved DEV/Preview Supabase project.
-- Creates isolated catalogue scan tables. No existing sales or catalogue rows are changed.
create table if not exists public.kk_drive_inventory (
  drive_file_id text primary key,
  store text not null,
  department text not null default 'Saree',
  fabric text not null,
  filename text not null,
  available boolean not null default true,
  last_seen_scan bigint not null,
  missing_full_scans integer not null default 0 check (missing_full_scans >= 0),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.kk_drive_scan_state (
  id integer primary key default 1 check(id=1),
  scan_number bigint not null default 0,
  last_completed_at timestamptz,
  last_item_count integer not null default 0
);
insert into public.kk_drive_scan_state(id) values (1) on conflict do nothing;
alter table public.kk_drive_inventory enable row level security;
alter table public.kk_drive_scan_state enable row level security;
revoke all on public.kk_drive_inventory from public, anon, authenticated;
revoke all on public.kk_drive_scan_state from public, anon, authenticated;
-- Execute only through service-role REST; function is NOT exposed to anon/authenticated.
create or replace function public.kk_apply_drive_full_scan(p_items jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_number bigint; v_total integer; v_unique integer; v_active integer; v_missing integer;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Expected an array'; end if;
  v_total := jsonb_array_length(p_items);
  if v_total = 0 or v_total > 25000 then raise exception 'Invalid scan count'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) x
    where nullif(trim(x->>'id'),'') is null or length(x->>'id') > 256
       or nullif(trim(x->>'store'),'') is null or length(x->>'store') > 128
       or nullif(trim(x->>'fabric'),'') is null or length(x->>'fabric') > 512
       or nullif(trim(x->>'filename'),'') is null or length(x->>'filename') > 1024) then
    raise exception 'Invalid scan record'; end if;
  select count(distinct x->>'id') into v_unique from jsonb_array_elements(p_items) x;
  if v_unique <> v_total then raise exception 'Duplicate file IDs'; end if;
  perform pg_advisory_xact_lock(1984, 2026);
  update public.kk_drive_scan_state set scan_number=scan_number+1 where id=1 returning scan_number into v_number;
  insert into public.kk_drive_inventory(drive_file_id,store,department,fabric,filename,available,last_seen_scan,missing_full_scans,updated_at)
  select x->>'id', x->>'store', coalesce(nullif(x->>'department',''),'Saree'), x->>'fabric', x->>'filename',true,v_number,0,now()
  from jsonb_array_elements(p_items) x
  on conflict (drive_file_id) do update set store=excluded.store, department=excluded.department,
    fabric=excluded.fabric,filename=excluded.filename,available=true,last_seen_scan=v_number,
    missing_full_scans=0, updated_at=now();
  update public.kk_drive_inventory set missing_full_scans=missing_full_scans+1,
    available = case when missing_full_scans+1 >= 2 then false else available end,
    updated_at=now()
  where last_seen_scan <> v_number;
  select count(*) into v_active from public.kk_drive_inventory where available;
  select count(*) into v_missing from public.kk_drive_inventory where not available;
  update public.kk_drive_scan_state set last_completed_at=now(),last_item_count=v_total where id=1;
  return jsonb_build_object('scan',v_number,'seen',v_total,'available',v_active,'unavailable',v_missing);
end $$;
revoke all on function public.kk_apply_drive_full_scan(jsonb) from public, anon, authenticated;
grant execute on function public.kk_apply_drive_full_scan(jsonb) to service_role;
