-- Late entries stay inside the race's lanes (found in testing: lane 6 of 5).

-- The lane count the organiser chose. 0 means a race made before this was kept,
-- and then the widest heat in the plan stands in for it.
alter table public.races add column lanes int not null default 0 check (lanes between 0 and 50);

-- setup_race again, now keeping the lane count the organiser chose.
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

  insert into races (org_id, name, race_date, venue, timezone, judging_style, start_style, format_name, lanes)
  values (p_org, trim(p->>'name'), (p->>'raceDate')::date, coalesce(p->>'venue', ''),
          coalesce(p->>'timezone', 'Africa/Johannesburg'), coalesce(p->>'judgingStyle', 'follow'), coalesce(p->>'startStyle', 'wave'),
          coalesce(p->>'formatName', ''), coalesce((p->>'lanes')::int, 0))
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

-- A late entry. With a heat number it takes the first free lane in that heat,
-- and never a lane past the race's lane count.
create or replace function public.add_entry(p_race uuid, p_code text, p_name text, p_division text, p_members jsonb, p_heat int default null)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  r races;
  v_div uuid;
  v_entry uuid;
  v_heat uuid;
  v_lanes int;
  v_lane int;
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
    v_lanes := r.lanes;
    if v_lanes = 0 then select coalesce(max(lane), 0) into v_lanes from heat_slots where race_id = p_race; end if;
    select min(l) into v_lane from generate_series(1, greatest(v_lanes, 1)) l
      where not exists (select 1 from heat_slots where heat_id = v_heat and lane = l);
    if v_lane is null then raise exception 'heat_full'; end if;
    insert into heat_slots (org_id, race_id, heat_id, lane, entry_id) values (r.org_id, p_race, v_heat, v_lane, v_entry);
  end if;
  update races set updated_at = now() where id = p_race;
  insert into audit_log (org_id, actor, action, target, after) values (r.org_id, auth.uid()::text, 'entry.add', v_entry::text, entry_json(v_entry));
  return entry_json(v_entry);
end $$;


-- The phone check compares each phone's clock with this. Starts and finishes
-- recorded on different phones only line up if their clocks agree.
create or replace function public.server_time() returns bigint
  language sql volatile as $$ select public.now_ms() $$;
revoke all on function public.server_time from public;
grant execute on function public.server_time to anon, authenticated;
