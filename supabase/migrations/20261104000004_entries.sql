-- Entries after the race is made (PRD 6C): athletes on entries, edit, swap an
-- athlete, move division, add and remove. Every change is in the audit log.

alter table public.races add column updated_at timestamptz not null default now();

-- Athletes for one entry, replacing whatever was there. Athletes that no longer
-- belong to any entry are deleted, so a swapped out person leaves no data behind.
create or replace function public.set_entry_members(p_org uuid, p_entry uuid, p_members jsonb) returns void
  language plpgsql security definer set search_path = public as $$
declare
  m jsonb;
  v_ath uuid;
  v_leg int := 0;
  v_old uuid[];
begin
  select coalesce(array_agg(athlete_id), '{}') into v_old from entry_members where entry_id = p_entry;
  delete from entry_members where entry_id = p_entry;
  for m in select * from jsonb_array_elements(coalesce(p_members, '[]')) loop
    if coalesce(trim(m #>> '{}'), '') = '' then continue; end if;
    v_leg := v_leg + 1;
    insert into athletes (org_id, name) values (p_org, left(trim(m #>> '{}'), 120)) returning id into v_ath;
    insert into entry_members (org_id, entry_id, athlete_id, relay_leg) values (p_org, p_entry, v_ath, v_leg);
  end loop;
  delete from athletes a where a.id = any(v_old) and not exists (select 1 from entry_members em where em.athlete_id = a.id);
end $$;
revoke all on function public.set_entry_members from public, anon, authenticated;

-- setup_race again, now with athletes on each entry.
create or replace function public.setup_race(p_org uuid, p jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_race uuid;
  d jsonb;
  s jsonb;
  x jsonb;
  e jsonb;
  h jsonb;
  sl jsonb;
  v_heat uuid;
  v_div uuid;
  v_seg uuid;
  v_entry uuid;
begin
  if not can_edit(p_org) then raise exception 'not_allowed'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'name_required'; end if;
  if jsonb_array_length(coalesce(p->'entries', '[]')) > 2000 then raise exception 'too_many_entries'; end if;

  insert into races (org_id, name, race_date, venue, timezone, judging_style, start_style, format_name)
  values (p_org, trim(p->>'name'), (p->>'raceDate')::date, coalesce(p->>'venue', ''),
          coalesce(p->>'timezone', 'Africa/Johannesburg'), coalesce(p->>'judgingStyle', 'follow'), coalesce(p->>'startStyle', 'wave'),
          coalesce(p->>'formatName', ''))
  returning id into v_race;

  for d in select * from jsonb_array_elements(coalesce(p->'divisions', '[]')) loop
    insert into divisions (org_id, race_id, code, label, gender, level, entry_kind, team_size)
    values (p_org, v_race, d->>'code', coalesce(d->>'label', d->>'code'), d->>'gender', d->>'level',
            coalesce(d->>'entryKind', 'team'), coalesce((d->>'teamSize')::int, 2));
  end loop;

  for s in select * from jsonb_array_elements(coalesce(p->'segments', '[]')) loop
    insert into segments (org_id, race_id, ord, kind, name, metric, timed, team_rule)
    values (p_org, v_race, (s->>'order')::int, s->>'kind', s->>'name', s->>'metric', coalesce((s->>'timed')::boolean, false), s->>'teamRule');
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p->'targets', '[]')) loop
    select id into v_seg from segments where race_id = v_race and ord = (x->>'segmentOrder')::int;
    select id into v_div from divisions where race_id = v_race and code = x->>'divisionCode';
    if v_seg is null or v_div is null then raise exception 'bad_target'; end if;
    insert into segment_targets (org_id, segment_id, division_id, value, weight, unit)
    values (p_org, v_seg, v_div, (x->>'value')::numeric, (x->>'weight')::numeric, x->>'unit');
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p->'entries', '[]')) loop
    select id into v_div from divisions where race_id = v_race and code = e->>'divisionCode';
    if v_div is null then raise exception 'unknown_division: %', e->>'divisionCode'; end if;
    insert into entries (org_id, race_id, division_id, kind, code, display_name)
    values (p_org, v_race, v_div, coalesce(e->>'kind', 'team'), e->>'code', e->>'displayName')
    returning id into v_entry;
    if jsonb_array_length(coalesce(e->'members', '[]')) > 0 then
      perform set_entry_members(p_org, v_entry, e->'members');
    end if;
  end loop;

  for h in select * from jsonb_array_elements(coalesce(p->'heats', '[]')) loop
    insert into heats (org_id, race_id, number, start_at)
    values (p_org, v_race, (h->>'number')::int, to_timestamp((h->>'startAt')::bigint / 1000.0))
    returning id into v_heat;
    for sl in select * from jsonb_array_elements(coalesce(h->'slots', '[]')) loop
      select id into v_entry from entries where race_id = v_race and code = sl->>'entryCode';
      if v_entry is null then raise exception 'unknown_entry: %', sl->>'entryCode'; end if;
      insert into heat_slots (org_id, race_id, heat_id, lane, entry_id)
      values (p_org, v_race, v_heat, (sl->>'lane')::int, v_entry);
    end loop;
  end loop;

  insert into audit_log (org_id, actor, action, target) values (p_org, auth.uid()::text, 'race.create', v_race::text);
  return v_race;
end $$;

create or replace function public.entry_json(p_entry uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', e.id, 'code', e.code, 'displayName', e.display_name, 'division', d.code,
                            'heat', (select h.number from heat_slots hs join heats h on h.id = hs.heat_id where hs.entry_id = e.id),
                            'members', coalesce((select jsonb_agg(a.name order by em.relay_leg) from entry_members em join athletes a on a.id = em.athlete_id
                                                 where em.entry_id = e.id), '[]'::jsonb))
  from entries e join divisions d on d.id = e.division_id where e.id = p_entry
$$;
revoke all on function public.entry_json from public, anon, authenticated;

-- Change number, name, division and athletes in one go.
create or replace function public.update_entry(p_entry uuid, p_code text, p_name text, p_division text, p_members jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v entries;
  v_div uuid;
  v_before jsonb;
begin
  select * into v from entries where id = p_entry;
  if v.id is null or not can_edit(v.org_id) then raise exception 'not_allowed'; end if;
  if p_code !~ '^\d{1,4}$' then raise exception 'bad_number'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  select id into v_div from divisions where race_id = v.race_id and code = p_division;
  if v_div is null then raise exception 'unknown_division'; end if;
  v_before := entry_json(p_entry);
  update entries set code = p_code, display_name = trim(p_name), division_id = v_div where id = p_entry;
  perform set_entry_members(v.org_id, p_entry, p_members);
  update races set updated_at = now() where id = v.race_id;
  insert into audit_log (org_id, actor, action, target, before, after)
    values (v.org_id, auth.uid()::text, 'entry.update', p_entry::text, v_before, entry_json(p_entry));
  return entry_json(p_entry);
end $$;

-- A late entry. With a heat number it takes the next free lane in that heat.
create or replace function public.add_entry(p_race uuid, p_code text, p_name text, p_division text, p_members jsonb, p_heat int default null)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  r races;
  v_div uuid;
  v_entry uuid;
  v_heat uuid;
  d divisions;
begin
  select * into r from races where id = p_race;
  if r.id is null or not can_edit(r.org_id) then raise exception 'not_allowed'; end if;
  if p_code !~ '^\d{1,4}$' then raise exception 'bad_number'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  select * into d from divisions where race_id = p_race and code = p_division;
  if d.id is null then raise exception 'unknown_division'; end if;
  insert into entries (org_id, race_id, division_id, kind, code, display_name)
    values (r.org_id, p_race, d.id, case when d.entry_kind = 'solo' then 'solo' else 'team' end, p_code, trim(p_name))
    returning id into v_entry;
  perform set_entry_members(r.org_id, v_entry, p_members);
  if p_heat is not null then
    select id into v_heat from heats where race_id = p_race and number = p_heat;
    if v_heat is null then raise exception 'unknown_heat'; end if;
    insert into heat_slots (org_id, race_id, heat_id, lane, entry_id)
      values (r.org_id, p_race, v_heat, coalesce((select max(lane) from heat_slots where heat_id = v_heat), 0) + 1, v_entry);
  end if;
  update races set updated_at = now() where id = p_race;
  insert into audit_log (org_id, actor, action, target, after) values (r.org_id, auth.uid()::text, 'entry.add', v_entry::text, entry_json(v_entry));
  return entry_json(v_entry);
end $$;

-- Only before any time is recorded for the entry. After that, use DNS or DNF.
create or replace function public.remove_entry(p_entry uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v entries;
  v_before jsonb;
begin
  select * into v from entries where id = p_entry;
  if v.id is null or not can_edit(v.org_id) then raise exception 'not_allowed'; end if;
  if exists (select 1 from timing_events where entry_id = p_entry) then raise exception 'has_times'; end if;
  v_before := entry_json(p_entry);
  perform set_entry_members(v.org_id, p_entry, '[]'::jsonb);
  delete from entries where id = p_entry;
  update races set updated_at = now() where id = v.race_id;
  insert into audit_log (org_id, actor, action, target, before) values (v.org_id, auth.uid()::text, 'entry.remove', p_entry::text, v_before);
end $$;

-- The organiser's race page also gets the athletes. Judges' snapshots do not.
create or replace function public.race_admin(p_race uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from races where id = p_race;
  if v_org is null or not is_member(v_org) then raise exception 'not_allowed'; end if;
  return race_json(p_race) || jsonb_build_object(
    'canEdit', can_edit(v_org),
    'members', coalesce((select jsonb_object_agg(e.id, (select coalesce(jsonb_agg(a.name order by em.relay_leg), '[]'::jsonb)
                                                         from entry_members em join athletes a on a.id = em.athlete_id where em.entry_id = e.id))
                         from entries e where e.race_id = p_race), '{}'::jsonb),
    'links', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'role', l.role, 'label', l.label, 'expiresAt', l.expires_at,
                                                          'revokedAt', l.revoked_at, 'createdAt', l.created_at) order by l.created_at desc)
                       from access_links l where l.race_id = p_race), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', t.id, 'raceId', t.race_id, 'deviceId', t.device_id, 'actorLinkId', t.actor_link_id,
                          'actorRole', t.actor_role, 'entryId', t.entry_id, 'deviceTs', t.device_ts, 'tzOffsetMin', t.tz_offset_min,
                          'seq', t.seq, 'serverTs', t.server_ts, 'payload', t.payload) order by t.server_seq)
                        from timing_events t where t.race_id = p_race), '[]'::jsonb)
  );
end $$;

revoke all on function public.update_entry, public.add_entry, public.remove_entry from public, anon;
grant execute on function public.update_entry, public.add_entry, public.remove_entry to authenticated;
