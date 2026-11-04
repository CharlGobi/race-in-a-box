-- Public results (PRD 6J) and visitor capture (PRD 6K, Phase 1 part).
-- Anyone with the race's public link can see results. No account, no names
-- beyond what the organiser entered, and initials for athletes who asked.

alter table public.races
  add column public_slug text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  add column results_public boolean not null default true;

-- The gym's trial class booking link lives in orgs.brand.trialUrl.

create table public.visitor_leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  race_id uuid not null,
  entry_code text not null default '',
  name text not null check (length(name) between 1 and 120),
  contact text not null check (length(contact) between 3 and 120),
  consent boolean not null,
  created_at timestamptz not null default now(),
  foreign key (race_id, org_id) references public.races(id, org_id) on delete cascade
);
create index visitor_leads_race on public.visitor_leads (race_id, created_at);

alter table public.visitor_leads enable row level security;
create policy visitor_leads_read on public.visitor_leads for select using (public.can_edit(org_id));
create policy visitor_leads_delete on public.visitor_leads for delete using (public.can_edit(org_id));
grant select, delete on public.visitor_leads to authenticated;

create or replace function public.initials(p_name text) returns text
  language sql immutable as $$
  select string_agg(upper(left(w, 1)) || '.', ' ')
  from unnest(regexp_split_to_array(trim(p_name), '\s+')) as w where w <> ''
$$;

-- Everything the public results page needs. Solo entries whose athlete asked
-- for initials show initials. Timing events carry no personal data.
create or replace function public.public_results(p_slug text) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  r races;
  o orgs;
begin
  select * into r from races where public_slug = p_slug and results_public;
  if r.id is null then raise exception 'results_not_found'; end if;
  select * into o from orgs where id = r.org_id;
  return (race_json(r.id) - 'entries') || jsonb_build_object(
    'org', jsonb_build_object('name', o.name, 'trialUrl', o.brand->>'trialUrl', 'poweredBy', o.powered_by),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'divisionId', e.division_id, 'kind', e.kind, 'code', e.code,
        'displayName', case
          when e.kind = 'solo' and exists (select 1 from entry_members em join athletes a on a.id = em.athlete_id
                                           where em.entry_id = e.id and a.show_as_initials)
          then initials(e.display_name) else e.display_name end) order by length(e.code), e.code)
      from entries e where e.race_id = r.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', t.id, 'raceId', t.race_id, 'deviceId', '', 'actorLinkId', t.actor_link_id,
                          'actorRole', t.actor_role, 'entryId', t.entry_id, 'deviceTs', t.device_ts, 'tzOffsetMin', 0,
                          'seq', t.seq, 'serverTs', t.server_ts, 'payload', t.payload) order by t.server_seq)
                        from timing_events t where t.race_id = r.id), '[]'::jsonb),
    'serverNow', now_ms()
  );
end $$;

-- "Book a trial class" from the share card. Only name, one way to reach them,
-- and their yes. A few per race number so the form can not be used to flood the gym.
create or replace function public.submit_visitor(p_slug text, p_entry_code text, p_name text, p_contact text, p_consent boolean) returns void
  language plpgsql security definer set search_path = public as $$
declare r races;
begin
  if not coalesce(p_consent, false) then raise exception 'consent_required'; end if;
  select * into r from races where public_slug = p_slug and results_public;
  if r.id is null then raise exception 'results_not_found'; end if;
  if (select count(*) from visitor_leads where race_id = r.id and entry_code = coalesce(p_entry_code, '')) >= 5 then
    raise exception 'too_many';
  end if;
  insert into visitor_leads (org_id, race_id, entry_code, name, contact, consent)
    values (r.org_id, r.id, coalesce(left(p_entry_code, 8), ''), trim(p_name), trim(p_contact), true);
end $$;

-- Organiser side: the trial link, public results on or off, and who asked for a trial.
create or replace function public.update_org_trial_url(p_org uuid, p_url text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not is_organiser(p_org) then raise exception 'not_allowed'; end if;
  if p_url is not null and p_url <> '' and p_url !~* '^https://' then raise exception 'bad_url'; end if;
  update orgs set brand = brand || jsonb_build_object('trialUrl', nullif(trim(p_url), '')) where id = p_org;
  insert into audit_log (org_id, actor, action, target) values (p_org, auth.uid()::text, 'org.trial_url', p_org::text);
end $$;

create or replace function public.race_public_info(p_race uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare r races;
begin
  select * into r from races where id = p_race;
  if r.id is null or not is_member(r.org_id) then raise exception 'not_allowed'; end if;
  return jsonb_build_object(
    'slug', r.public_slug, 'public', r.results_public,
    'trialUrl', (select brand->>'trialUrl' from orgs where id = r.org_id),
    'visitors', case when can_edit(r.org_id) then coalesce((
      select jsonb_agg(jsonb_build_object('name', v.name, 'contact', v.contact, 'entryCode', v.entry_code, 'at', v.created_at) order by v.created_at desc)
      from visitor_leads v where v.race_id = r.id), '[]'::jsonb) else '[]'::jsonb end);
end $$;

create or replace function public.set_results_public(p_race uuid, p_public boolean) returns void
  language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from races where id = p_race;
  if v_org is null or not can_edit(v_org) then raise exception 'not_allowed'; end if;
  update races set results_public = p_public where id = p_race;
  insert into audit_log (org_id, actor, action, target, after) values (v_org, auth.uid()::text, 'race.results_public', p_race::text, to_jsonb(p_public));
end $$;

revoke all on function public.public_results, public.submit_visitor from public;
grant execute on function public.public_results, public.submit_visitor to anon, authenticated;
revoke all on function public.update_org_trial_url, public.race_public_info, public.set_results_public from public, anon;
grant execute on function public.update_org_trial_url, public.race_public_info, public.set_results_public to authenticated;

-- my_orgs again, now with the trial link so the gym page can show it.
create or replace function public.my_orgs() returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'subdomain', o.subdomain, 'role', m.role, 'plan', o.plan,
                                               'trialUrl', o.brand->>'trialUrl')
                            order by o.created_at), '[]'::jsonb)
  from org_members m join orgs o on o.id = m.org_id
  where m.user_id = auth.uid()
$$;
