begin;

create schema if not exists stormcore_internal;
revoke all on schema stormcore_internal from public, anon, authenticated;
grant usage on schema stormcore_internal to service_role;

create table stormcore_internal.pilots (
  digest text primary key check (digest ~ '^[0-9a-f]{64}$'),
  cleared integer not null default 0 check (cleared between 0 and 12),
  best integer not null default 0 check (best between 0 and 1000000000)
);
alter table stormcore_internal.pilots enable row level security;
alter table stormcore_internal.pilots force row level security;
revoke all on stormcore_internal.pilots from public, anon, authenticated;
grant select, insert, update on stormcore_internal.pilots to service_role;

create function public.stormcore_exchange_progress(
  code_hash text,
  command text,
  incoming_cleared integer,
  incoming_best integer
)
returns table (cleared integer, best integer)
language plpgsql
security invoker
set search_path = ''
as $stormcore$
begin
  if code_hash is null or code_hash !~ '^[0-9a-f]{64}$' or
     command is null or command not in ('create','load','save') or
     incoming_cleared is null or incoming_cleared not between 0 and 12 or
     incoming_best is null or incoming_best not between 0 and 1000000000 then
    raise exception 'Invalid progress request' using errcode = '22023';
  end if;

  if command = 'create' then
    return query
      insert into stormcore_internal.pilots as pilot (digest,cleared,best)
      values (code_hash,incoming_cleared,incoming_best)
      on conflict (digest) do update set digest = excluded.digest
      returning pilot.cleared,pilot.best;
  elsif command = 'save' then
    return query
      update stormcore_internal.pilots as pilot
      set cleared = greatest(pilot.cleared,incoming_cleared),
          best = greatest(pilot.best,incoming_best)
      where pilot.digest = code_hash
      returning pilot.cleared,pilot.best;
  else
    return query
      select pilot.cleared,pilot.best from stormcore_internal.pilots as pilot
      where pilot.digest = code_hash;
  end if;
end;
$stormcore$;

revoke all on function public.stormcore_exchange_progress(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.stormcore_exchange_progress(text,text,integer,integer) to service_role;
notify pgrst, 'reload schema';

commit;
