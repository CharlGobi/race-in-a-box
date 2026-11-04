-- Race builder (PRD 6B): entry types per division, team rules per segment,
-- targets per division, and saved formats per gym.

alter table public.divisions
  add column entry_kind text not null default 'team' check (entry_kind in ('solo', 'team', 'relay')),
  add column team_size int not null default 2 check (team_size between 1 and 20),
  add constraint divisions_solo_size check (entry_kind <> 'solo' or team_size = 1);

alter table public.segments
  add column team_rule text check (team_rule in ('shared', 'each', 'split'));

alter table public.races add column format_name text not null default '';

-- Saved formats ---------------------------------------------------------------

create table public.race_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  body jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pg_column_size(body) < 200000),
  unique (id, org_id)
);

alter table public.race_templates enable row level security;
create policy race_templates_read on public.race_templates for select using (public.is_member(org_id));
create policy race_templates_insert on public.race_templates for insert with check (public.can_edit(org_id));
create policy race_templates_update on public.race_templates for update using (public.can_edit(org_id)) with check (public.can_edit(org_id));
create policy race_templates_delete on public.race_templates for delete using (public.can_edit(org_id));
grant select, insert, update, delete on public.race_templates to authenticated;

create or replace function public.list_templates(p_org uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member(p_org) then raise exception 'not_allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'body', t.body, 'updatedAt', t.updated_at)
                                    order by t.updated_at desc)
                   from race_templates t where t.org_id = p_org), '[]'::jsonb);
end $$;

-- Insert when p_id is null, otherwise update that template in the same gym.
create or replace function public.save_template(p_org uuid, p_id uuid, p_name text, p_body jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not can_edit(p_org) then raise exception 'not_allowed'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  if p_name ~* '\m(hyrox|hrx|rox|hy)\M' then raise exception 'brand_word'; end if;
  if p_id is null then
    insert into race_templates (org_id, name, body, created_by) values (p_org, trim(p_name), p_body, auth.uid()) returning id into v_id;
  else
    update race_templates set name = trim(p_name), body = p_body, updated_at = now()
      where id = p_id and org_id = p_org returning id into v_id;
    if v_id is null then raise exception 'not_allowed'; end if;
  end if;
  insert into audit_log (org_id, actor, action, target) values (p_org, auth.uid()::text, 'template.save', v_id::text);
  return v_id;
end $$;

create or replace function public.delete_template(p_org uuid, p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not can_edit(p_org) then raise exception 'not_allowed'; end if;
  delete from race_templates where id = p_id and org_id = p_org;
  insert into audit_log (org_id, actor, action, target) values (p_org, auth.uid()::text, 'template.delete', p_id::text);
end $$;

-- Race JSON now carries entry types, team rules and targets ---------------------

create or replace function public.race_json(p_race uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'race', jsonb_build_object('id', r.id, 'orgId', r.org_id, 'name', r.name, 'raceDate', r.race_date, 'venue', r.venue,
                               'timezone', r.timezone, 'judgingStyle', r.judging_style, 'startStyle', r.start_style,
                               'splitsOn', r.splits_on, 'disagreeThresholdMs', r.disagree_threshold_ms, 'status', r.status,
                               'formatName', r.format_name),
    'divisions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code, 'label', d.label, 'gender', d.gender, 'level', d.level,
                                                               'entryKind', d.entry_kind, 'teamSize', d.team_size) order by d.code)
                           from divisions d where d.race_id = r.id), '[]'::jsonb),
    'segments', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'order', s.ord, 'kind', s.kind, 'name', s.name, 'metric', s.metric,
                                                              'timed', s.timed, 'teamRule', s.team_rule) order by s.ord)
                          from segments s where s.race_id = r.id), '[]'::jsonb),
    'targets', coalesce((select jsonb_agg(jsonb_build_object('segmentId', st.segment_id, 'divisionId', st.division_id, 'value', st.value,
                                                             'unit', st.unit, 'weight', st.weight))
                         from segment_targets st join segments s on s.id = st.segment_id where s.race_id = r.id), '[]'::jsonb),
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

revoke all on function public.list_templates, public.save_template, public.delete_template from public, anon;
grant execute on function public.list_templates, public.save_template, public.delete_template to authenticated;
