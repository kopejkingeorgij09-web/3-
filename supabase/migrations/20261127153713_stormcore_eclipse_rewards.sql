begin;

alter table stormcore_internal.pilots
  drop constraint pilots_favorite_slot_check,
  drop constraint pilots_duel_cleared_check,
  add constraint pilots_favorite_slot_check check (favorite_slot between 0 and 23),
  add constraint pilots_duel_cleared_check check (duel_cleared between 0 and 30),
  add column duel_paid smallint not null default 0 check (duel_paid between 0 and 30);

create or replace function public.stormcore_exchange_campaign_v3(code_hash text, payload jsonb)
returns table (
  cleared integer, best integer, credits integer, owned smallint[], bought boolean,
  epoch integer, favorite smallint, tuning jsonb, has_archive boolean
)
language plpgsql
security invoker
set search_path = ''
as $workshop$
declare
  pilot stormcore_internal.pilots%rowtype;
  operation text := payload->>'action';
  request_epoch integer := (payload->>'epoch')::integer;
  incoming_cleared integer := (payload->>'cleared')::integer;
  incoming_best integer := (payload->>'best')::integer;
  flight_awards jsonb := coalesce(payload->'flights','[]'::jsonb);
  ship integer := (payload->>'ship')::integer;
  tuning_kind text := payload->>'tuningKind';
  expected_tier integer := (payload->>'expectedTier')::integer;
  transition_id uuid := (payload->>'transition')::uuid;
  initial_credits integer := coalesce((payload->>'credits')::integer,0);
  initial_owned smallint[] := array(select value::smallint from pg_catalog.jsonb_array_elements_text(coalesce(payload->'owned','[0]'::jsonb)) as value);
  initial_favorite smallint := (payload->>'favorite')::smallint;
  initial_tuning jsonb := coalesce(payload->'tuning','{}'::jsonb);
  snapshot jsonb;
  previous jsonb;
  applied boolean := false;
  total integer;
  price integer;
  tier integer;
  price_table constant integer[] := array[0,420,1050,2100,3600,5100,6900,8900,11100,14300,17000,19700,22800,26100,29800,34000,39000,45000,48000,null,52000,null,61000,null];
  engine constant integer[] := array[550,1100,2100];
  armor constant integer[] := array[650,1250,2350];
  weapon constant integer[] := array[700,1400,2600];
begin
  if code_hash is null or code_hash !~ '^[0-9a-f]{64}$'
    or operation is null or operation not in ('load','create','save','buy','favorite','tune','reset','restore')
    or request_epoch is null or request_epoch < 0
    or incoming_cleared is null or incoming_cleared not between 0 and 24
    or incoming_best is null or incoming_best not between 0 and 1000000000
    or pg_catalog.jsonb_typeof(flight_awards) <> 'array' or pg_catalog.jsonb_array_length(flight_awards) > 40
    or (operation = 'buy' and (ship is null or ship not between 1 and 23))
    or (operation = 'favorite' and ship is not null and ship not between 0 and 23)
    or (operation = 'tune' and (ship is null or ship not between 0 and 23
         or tuning_kind is null or tuning_kind not in ('engine','armor','weapon')
         or expected_tier is null or expected_tier not between 0 and 2))
    or (operation in ('reset','restore') and transition_id is null)
    or initial_credits not between 0 and 1000000000 or pg_catalog.cardinality(initial_owned)>24
    or not (initial_owned <@ array[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]::smallint[])
    or pg_catalog.jsonb_typeof(initial_tuning) <> 'object' then
    raise exception 'Invalid workshop request' using errcode = '22023';
  end if;

  if operation = 'create' then
    if exists (
      select 1
      from pg_catalog.jsonb_each(initial_tuning) slot
      where slot.key !~ '^(?:[0-9]|1[0-9]|2[0-3])$' or (slot.key::smallint <> 0 and not slot.key::smallint = any(initial_owned))
        or pg_catalog.jsonb_typeof(slot.value) <> 'object'
    ) then
      raise exception 'Invalid workshop loadout' using errcode = '22023';
    end if;
    if exists (
      select 1 from pg_catalog.jsonb_each(initial_tuning) slot
      cross join lateral pg_catalog.jsonb_each_text(slot.value) upgrade
      where upgrade.key not in ('engine','armor','weapon') or upgrade.value !~ '^[0-3]$'
    ) then
      raise exception 'Invalid workshop tier' using errcode = '22023';
    end if;

    insert into stormcore_internal.pilots (digest,cleared,best,credits,owned,hangar_ready,favorite_slot,tuning_levels,duel_paid)
    values (
      code_hash,incoming_cleared,incoming_best,initial_credits,
      array(select distinct slot from pg_catalog.unnest(initial_owned || 0::smallint) as slot order by slot),
      true,
      case when initial_favorite = 0 or initial_favorite = any(initial_owned) then initial_favorite end,
      initial_tuning,coalesce((payload->>'duelPaid')::smallint,0)
    ) on conflict (digest) do nothing;
  end if;

  select p.* into pilot from stormcore_internal.pilots p where p.digest = code_hash for update;
  if not found then return; end if;

  if not pilot.hangar_ready then
    total := greatest(pilot.cleared,case when request_epoch = pilot.campaign_epoch then incoming_cleared else 0 end);
    pilot.owned := array[0]::smallint[]
      || case when total>=1 then array[1]::smallint[] else array[]::smallint[] end
      || case when total>=3 then array[2]::smallint[] else array[]::smallint[] end
      || case when total>=5 then array[3]::smallint[] else array[]::smallint[] end
      || case when total>=8 then array[4]::smallint[] else array[]::smallint[] end;
    pilot.hangar_ready := true;
    update stormcore_internal.pilots p set owned=pilot.owned,hangar_ready=true where p.digest=code_hash;
  end if;

  if operation in ('reset','restore') and exists (
    select 1 from stormcore_internal.campaign_transitions as change
    where change.pilot_digest = code_hash and change.request_id = transition_id and change.action = operation
  ) then
    applied := true;
  elsif request_epoch = pilot.campaign_epoch and operation not in ('load','create') then
    if operation not in ('reset','restore') then
      with credited as (
        insert into stormcore_internal.flight_awards as a (pilot_digest,flight_id,credit)
        select code_hash,flight.id,flight.amount
        from pg_catalog.jsonb_to_recordset(flight_awards) as flight(id uuid,amount integer)
        on conflict (pilot_digest,flight_id) do nothing
        returning a.credit
      )
      select coalesce(sum(credit),0) into total from credited;
      pilot.cleared := greatest(pilot.cleared,incoming_cleared);
      pilot.best := greatest(pilot.best,incoming_best);
      pilot.credits := least(1000000000,pilot.credits+total);
    end if;

    if operation = 'buy' then
      price := price_table[ship+1];
      if ship::smallint = any(pilot.owned) then
        applied := true;
      elsif price is not null and pilot.credits >= price then
        pilot.credits := pilot.credits-price;
        pilot.owned := pilot.owned || ship::smallint;
        applied := true;
      end if;
    elsif operation = 'favorite' then
      if ship is null or ship::smallint = any(pilot.owned) then
        pilot.favorite_slot := ship;
        applied := true;
      end if;
    elsif operation = 'tune' then
      if ship::smallint = any(pilot.owned) then
        tier := coalesce((pilot.tuning_levels->ship::text->>tuning_kind)::integer,0);
        price := case tuning_kind when 'engine' then engine[tier+1] when 'armor' then armor[tier+1] else weapon[tier+1] end;
        if tier > expected_tier then
          applied := true;
        elsif tier = expected_tier and pilot.credits>=price then
          pilot.credits := pilot.credits-price;
          pilot.tuning_levels := pg_catalog.jsonb_set(pilot.tuning_levels,array[ship::text],
            coalesce(pilot.tuning_levels->ship::text,'{}'::jsonb) || pg_catalog.jsonb_build_object(tuning_kind,tier+1),true);
          applied := true;
        end if;
      end if;
    elsif operation = 'reset' or (operation = 'restore' and pilot.campaign_archive is not null) then
      previous := pilot.campaign_archive;
      insert into stormcore_internal.campaign_transitions (pilot_digest,request_id,action,previous_epoch,previous_archive)
        values (code_hash,transition_id,operation,pilot.campaign_epoch,previous);
      if not (operation = 'reset' and previous is not null
         and pilot.cleared=0 and pilot.best=0 and pilot.credits=0 and pilot.owned=array[0]::smallint[]
         and pilot.favorite_slot is null and pilot.tuning_levels='{}'::jsonb) then
        snapshot := pg_catalog.jsonb_build_object('cleared',pilot.cleared,'best',pilot.best,'credits',pilot.credits,
          'owned',pilot.owned,'favorite',pilot.favorite_slot,'tuning',pilot.tuning_levels);
        pilot.campaign_archive := snapshot;
        pilot.campaign_epoch := pilot.campaign_epoch+1;
        if operation = 'reset' then
          pilot.cleared := 0;
          pilot.best := 0;
          pilot.credits := 0;
          pilot.owned := array[0]::smallint[];
          pilot.favorite_slot := null;
          pilot.tuning_levels := '{}'::jsonb;
        else
          pilot.cleared := (previous->>'cleared')::integer;
          pilot.best := (previous->>'best')::integer;
          pilot.credits := (previous->>'credits')::integer;
          pilot.owned := array(select value::smallint from pg_catalog.jsonb_array_elements_text(previous->'owned') as value);
          pilot.favorite_slot := (previous->>'favorite')::smallint;
          pilot.tuning_levels := previous->'tuning';
        end if;
      end if;
      applied := true;
    end if;

    update stormcore_internal.pilots p
      set cleared=pilot.cleared,best=pilot.best,credits=pilot.credits,owned=pilot.owned,
          favorite_slot=pilot.favorite_slot,tuning_levels=pilot.tuning_levels,
          campaign_epoch=pilot.campaign_epoch,campaign_archive=pilot.campaign_archive
      where p.digest=code_hash;
  end if;

  return query select pilot.cleared,pilot.best,pilot.credits,pilot.owned,applied,
    pilot.campaign_epoch,pilot.favorite_slot,pilot.tuning_levels,(pilot.campaign_archive is not null);
end;
$workshop$;

revoke all on function public.stormcore_exchange_campaign_v3(text,jsonb) from public, anon, authenticated;
grant execute on function public.stormcore_exchange_campaign_v3(text,jsonb) to service_role;

create function public.stormcore_exchange_campaign_v5(code_hash text, payload jsonb)
returns table (
  cleared integer, best integer, credits integer, owned smallint[], bought boolean,
  epoch integer, favorite smallint, tuning jsonb, has_archive boolean, duels smallint, duel_paid smallint
)
language plpgsql security invoker set search_path = ''
as $rewards$
declare
  campaign record;
  pilot stormcore_internal.pilots%rowtype;
  incoming integer := (payload->>'duels')::integer;
  imported integer := coalesce((payload->>'duelPaid')::integer,0);
  bonus integer;
  unlocked smallint[];
  original_duels smallint;
begin
  if incoming is null or incoming not between 0 and 30 or imported not between 0 and incoming then
    raise exception 'Invalid duel progress' using errcode='22023';
  end if;
  select * into campaign from public.stormcore_exchange_campaign_v3(code_hash,payload);
  if not found then return; end if;
  select p.* into pilot from stormcore_internal.pilots p where p.digest=code_hash;
  original_duels:=pilot.duel_cleared;
  if payload->>'action' in ('save','create') then
    pilot.duel_cleared := greatest(pilot.duel_cleared,incoming);
  end if;
  select coalesce(sum(200+(stage-1)*25),0) into bonus
    from pg_catalog.generate_series(pilot.duel_paid+1,pilot.duel_cleared) stage;
  unlocked := pilot.owned;
  if pilot.duel_cleared>=5 and not 19=any(unlocked) then unlocked:=unlocked||19::smallint; end if;
  if pilot.duel_cleared>=15 and not 21=any(unlocked) then unlocked:=unlocked||21::smallint; end if;
  if pilot.duel_cleared>=30 and not 23=any(unlocked) then unlocked:=unlocked||23::smallint; end if;
  if original_duels<>pilot.duel_cleared or pilot.duel_paid<>pilot.duel_cleared or unlocked<>pilot.owned then
    update stormcore_internal.pilots p set duel_cleared=pilot.duel_cleared,duel_paid=pilot.duel_cleared,
      credits=least(1000000000,pilot.credits+bonus),owned=unlocked
      where p.digest=code_hash returning p.* into pilot;
  end if;
  return query select pilot.cleared,pilot.best,pilot.credits,pilot.owned,campaign.bought,
    pilot.campaign_epoch,pilot.favorite_slot,pilot.tuning_levels,(pilot.campaign_archive is not null),pilot.duel_cleared,pilot.duel_paid;
end;
$rewards$;

revoke all on function public.stormcore_exchange_campaign_v5(text,jsonb) from public, anon, authenticated;
grant execute on function public.stormcore_exchange_campaign_v5(text,jsonb) to service_role;

commit;
