-- Head judge tools (PRD 6F): each race has its own protest window, which the
-- organiser can change. Delays, locks, penalties and statuses are timing events,
-- so they need no new tables.

alter table public.races add column protest_window_min int not null default 15 check (protest_window_min between 0 and 240);

create or replace function public.race_json(p_race uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'race', jsonb_build_object('id', r.id, 'orgId', r.org_id, 'name', r.name, 'raceDate', r.race_date, 'venue', r.venue,
                               'timezone', r.timezone, 'judgingStyle', r.judging_style, 'startStyle', r.start_style,
                               'splitsOn', r.splits_on, 'disagreeThresholdMs', r.disagree_threshold_ms, 'status', r.status,
                               'formatName', r.format_name, 'protestWindowMin', r.protest_window_min),
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

create or replace function public.update_race_settings(p_race uuid, p_protest_window_min int) returns void
  language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from races where id = p_race;
  if v_org is null or not can_edit(v_org) then raise exception 'not_allowed'; end if;
  update races set protest_window_min = p_protest_window_min, updated_at = now() where id = p_race;
  insert into audit_log (org_id, actor, action, target, after)
    values (v_org, auth.uid()::text, 'race.settings', p_race::text, jsonb_build_object('protestWindowMin', p_protest_window_min));
end $$;

revoke all on function public.update_race_settings from public, anon;
grant execute on function public.update_race_settings to authenticated;
