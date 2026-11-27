begin;

alter table stormcore_internal.pilots
  add column duel_cleared smallint not null default 0 check (duel_cleared between 0 and 15);

create function public.stormcore_exchange_campaign_v4(code_hash text, payload jsonb)
returns table (
  cleared integer, best integer, credits integer, owned smallint[], bought boolean,
  epoch integer, favorite smallint, tuning jsonb, has_archive boolean, duels smallint
)
language plpgsql
security invoker
set search_path = ''
as $duels$
declare
  campaign record;
  previous_duels smallint;
  incoming_duels integer := (payload->>'duels')::integer;
begin
  if incoming_duels is null or incoming_duels not between 0 and 15 then
    raise exception 'Invalid duel progress' using errcode = '22023';
  end if;

  -- The existing exchange locks the pilot while both progress tracks are read or updated.
  select * into campaign from public.stormcore_exchange_campaign_v3(code_hash,payload);
  if not found then return; end if;

  select p.duel_cleared into previous_duels
    from stormcore_internal.pilots p where p.digest = code_hash;
  if payload->>'action' in ('create','save') and incoming_duels > previous_duels then
    update stormcore_internal.pilots p set duel_cleared = incoming_duels
      where p.digest = code_hash returning p.duel_cleared into previous_duels;
  end if;

  return query select campaign.cleared,campaign.best,campaign.credits,campaign.owned,campaign.bought,
    campaign.epoch,campaign.favorite,campaign.tuning,campaign.has_archive,previous_duels;
end;
$duels$;

revoke all on function public.stormcore_exchange_campaign_v4(text,jsonb) from public, anon, authenticated;
grant execute on function public.stormcore_exchange_campaign_v4(text,jsonb) to service_role;

commit;
