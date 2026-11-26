begin;

alter table stormcore_internal.pilots
  drop constraint pilots_cleared_check,
  add constraint pilots_cleared_check check (cleared between 0 and 24),
  add column credits integer not null default 0 check (credits between 0 and 1000000000),
  add column owned smallint[] not null default array[0]::smallint[],
  add column hangar_ready boolean not null default false;

create table stormcore_internal.flight_awards (
  pilot_digest text not null references stormcore_internal.pilots(digest) on delete cascade,
  flight_id uuid not null,
  credit integer not null check (credit between 1 and 100000),
  primary key (pilot_digest,flight_id)
);
alter table stormcore_internal.flight_awards enable row level security;
alter table stormcore_internal.flight_awards force row level security;
revoke all on stormcore_internal.flight_awards from public, anon, authenticated;
grant select, insert on stormcore_internal.flight_awards to service_role;

create function public.stormcore_exchange_campaign(
  code_hash text, command text, incoming_cleared integer, incoming_best integer,
  flight_awards jsonb, purchase integer, initial_credits integer, initial_owned smallint[]
)
returns table (cleared integer, best integer, credits integer, owned smallint[], bought boolean)
language plpgsql
security invoker
set search_path = ''
as $campaign$
declare
  pilot stormcore_internal.pilots%rowtype;
  total_awarded integer;
  price integer;
  did_buy boolean := false;
  prices constant integer[] := array[0,420,1050,2100,3600,5100,6900,8900,11100,14300];
begin
  if code_hash is null or code_hash !~ '^[0-9a-f]{64}$'
     or command is null or command not in ('create','load','save','buy')
     or incoming_cleared is null or incoming_cleared not between 0 and 24
     or incoming_best is null or incoming_best not between 0 and 1000000000
     or flight_awards is null or pg_catalog.jsonb_typeof(flight_awards) <> 'array'
     or pg_catalog.jsonb_array_length(flight_awards) > 40
     or (command = 'buy' and (purchase is null or purchase not between 1 and 9))
     or initial_credits is null or initial_credits not between 0 and 1000000000
     or initial_owned is null or pg_catalog.cardinality(initial_owned) > 10
     or not (initial_owned <@ array[0,1,2,3,4,5,6,7,8,9]::smallint[]) then
    raise exception 'Invalid campaign progress request' using errcode = '22023';
  end if;

  if command = 'create' then
    insert into stormcore_internal.pilots (digest,cleared,best,credits,owned,hangar_ready)
    values (
      code_hash,incoming_cleared,incoming_best,initial_credits,
      array(select distinct ship from pg_catalog.unnest(initial_owned || 0::smallint) as ship order by ship),
      true
    )
    on conflict (digest) do nothing;
  end if;

  select p.* into pilot from stormcore_internal.pilots p where p.digest = code_hash for update;
  if not found then return; end if;

  if not pilot.hangar_ready then
    pilot.owned := array[0]::smallint[]
      || case when greatest(pilot.cleared,incoming_cleared) >= 1 then array[1]::smallint[] else array[]::smallint[] end
      || case when greatest(pilot.cleared,incoming_cleared) >= 3 then array[2]::smallint[] else array[]::smallint[] end
      || case when greatest(pilot.cleared,incoming_cleared) >= 5 then array[3]::smallint[] else array[]::smallint[] end
      || case when greatest(pilot.cleared,incoming_cleared) >= 8 then array[4]::smallint[] else array[]::smallint[] end;
  end if;

  with credited as (
    insert into stormcore_internal.flight_awards as a (pilot_digest,flight_id,credit)
    select code_hash,flight.id,flight.amount
    from pg_catalog.jsonb_to_recordset(flight_awards) as flight(id uuid,amount integer)
    on conflict (pilot_digest,flight_id) do nothing
    returning a.credit
  )
  select coalesce(sum(credit),0) into total_awarded from credited;

  pilot.credits := least(1000000000,pilot.credits + total_awarded);
  if command = 'buy' then
    price := prices[purchase + 1];
    if purchase::smallint = any(pilot.owned) then
      did_buy := true;
    elsif pilot.credits >= price then
      pilot.credits := pilot.credits - price;
      pilot.owned := pilot.owned || purchase::smallint;
      did_buy := true;
    end if;
  end if;

  update stormcore_internal.pilots as p
    set cleared = greatest(pilot.cleared,incoming_cleared),
        best = greatest(pilot.best,incoming_best),
        credits = pilot.credits, owned = pilot.owned, hangar_ready = true
    where p.digest = code_hash
    returning p.cleared,p.best,p.credits,p.owned,did_buy
    into cleared,best,credits,owned,bought;
  return next;
end;
$campaign$;

revoke all on function public.stormcore_exchange_campaign(text,text,integer,integer,jsonb,integer,integer,smallint[])
  from public, anon, authenticated;
grant execute on function public.stormcore_exchange_campaign(text,text,integer,integer,jsonb,integer,integer,smallint[])
  to service_role;
notify pgrst, 'reload schema';

commit;
