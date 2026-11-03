-- Organiser functions. The organiser screens talk to the database only through
-- these, so every write is one transaction and every check sits in one place.

-- The race as the app's Race type, shared by judges (by link) and organisers (by login).
create or replace function public.race_json(p_race uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'race', jsonb_build_object('id', r.id, 'orgId', r.org_id, 'name', r.name, 'raceDate', r.race_date, 'venue', r.venue,
                               'timezone', r.timezone, 'judgingStyle', r.judging_style, 'startStyle', r.start_style,
                               'splitsOn', r.splits_on, 'disagreeThresholdMs', r.disagree_threshold_ms, 'status', r.status),
    'divisions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code, 'label', d.label, 'gender', d.gender, 'level', d.level) order by d.code)
                           from divisions d where d.race_id = r.id), '[]'::jsonb),
    'segments', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'order', s.ord, 'kind', s.kind, 'name', s.name, 'metric', s.metric, 'timed', s.timed) order by s.ord)
                          from segments s where s.race_id = r.id), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'divisionId', e.division_id, 'kind', e.kind, 'code', e.code, 'displayName', e.display_name)
                                          order by length(e.code), e.code)
                         from entries e where e.race_id = r.id), '[]'::jsonb),
    'heats', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', h.id, 'number', h.number, 'startAt', (extract(epoch from h.start_at) * 1000)::bigint,
                         'slots', coalesce((select jsonb_agg(jsonb_build_object('lane', hs.lane, 'entryId', hs.entry_id) order by hs.lane)
                                            from heat_slots hs where hs.heat_id = h.id), '[]'::jsonb)) order by h.number)
                       from heats h where h.race_id = r.id), '[]'::jsonb)
  )
  from races r where r.id = p_race
$$;
revoke all on function public.race_json from public, anon, authenticated;

create or replace function public.race_snapshot(p_token text) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare v access_links;
begin
  v := check_link(p_token);
  return race_json(v.race_id) || jsonb_build_object(
    'link', jsonb_build_object('id', v.id, 'role', v.role, 'label', v.label, 'scope', v.scope, 'expiresAt', v.expires_at));
end $$;

-- What the signed in organiser belongs to.
create or replace function public.my_orgs() returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'subdomain', o.subdomain, 'role', m.role, 'plan', o.plan)
                            order by o.created_at), '[]'::jsonb)
  from org_members m join orgs o on o.id = m.org_id
  where m.user_id = auth.uid()
$$;

create or replace function public.list_races(p_org uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member(p_org) then raise exception 'not_allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'raceDate', r.race_date, 'venue', r.venue, 'status', r.status,
                                        'entries', (select count(*) from entries e where e.race_id = r.id))
                     order by r.race_date desc, r.created_at desc)
    from races r where r.org_id = p_org), '[]'::jsonb);
end $$;

-- Create a whole race in one go: divisions, segments, entries and heats.
-- Entries and heat slots refer to divisions and entries by their codes.
create or replace function public.setup_race(p_org uuid, p jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_race uuid;
  d jsonb;
  s jsonb;
  e jsonb;
  h jsonb;
  sl jsonb;
  v_heat uuid;
  v_div uuid;
  v_entry uuid;
begin
  if not can_edit(p_org) then raise exception 'not_allowed'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'name_required'; end if;
  if jsonb_array_length(coalesce(p->'entries', '[]')) > 2000 then raise exception 'too_many_entries'; end if;

  insert into races (org_id, name, race_date, venue, timezone, judging_style, start_style)
  values (p_org, trim(p->>'name'), (p->>'raceDate')::date, coalesce(p->>'venue', ''),
          coalesce(p->>'timezone', 'Africa/Johannesburg'), coalesce(p->>'judgingStyle', 'follow'), coalesce(p->>'startStyle', 'wave'))
  returning id into v_race;

  for d in select * from jsonb_array_elements(coalesce(p->'divisions', '[]')) loop
    insert into divisions (org_id, race_id, code, label, gender)
    values (p_org, v_race, d->>'code', coalesce(d->>'label', d->>'code'), d->>'gender');
  end loop;

  for s in select * from jsonb_array_elements(coalesce(p->'segments', '[]')) loop
    insert into segments (org_id, race_id, ord, kind, name, metric, timed)
    values (p_org, v_race, (s->>'order')::int, s->>'kind', s->>'name', s->>'metric', coalesce((s->>'timed')::boolean, false));
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p->'entries', '[]')) loop
    select id into v_div from divisions where race_id = v_race and code = e->>'divisionCode';
    if v_div is null then raise exception 'unknown_division: %', e->>'divisionCode'; end if;
    insert into entries (org_id, race_id, division_id, kind, code, display_name)
    values (p_org, v_race, v_div, coalesce(e->>'kind', 'team'), e->>'code', e->>'displayName');
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

-- Everything the organiser's race page shows: the race, its links and its timing log.
create or replace function public.race_admin(p_race uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from races where id = p_race;
  if v_org is null or not is_member(v_org) then raise exception 'not_allowed'; end if;
  return race_json(p_race) || jsonb_build_object(
    'canEdit', can_edit(v_org),
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

revoke all on function public.my_orgs, public.list_races, public.setup_race, public.race_admin from public, anon;
grant execute on function public.my_orgs, public.list_races, public.setup_race, public.race_admin to authenticated;
grant execute on function public.race_snapshot to anon, authenticated;
