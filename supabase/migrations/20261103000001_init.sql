-- Race in a Box, first migration.
-- PRD section 5: Postgres, row level security on org_id for every table, UUIDs.
-- Accounts belong to organisers. Judges and volunteers never log in: they hold a
-- signed link, and the link functions at the bottom check it on every call.

-- Helpers -----------------------------------------------------------------

create or replace function public.now_ms() returns bigint
  language sql volatile as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;

-- Orgs and members --------------------------------------------------------

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  subdomain text not null unique check (subdomain ~ '^[a-z0-9]([a-z0-9]{0,30}[a-z0-9])?$'),
  brand jsonb not null default '{}'::jsonb,
  country text not null default 'ZA',
  currency text not null default 'ZAR',
  plan text not null default 'free',
  powered_by boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('organiser', 'staff', 'head_judge')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- Security definer so policies can read memberships without recursing into RLS.
create or replace function public.is_member(p_org uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid())
$$;

create or replace function public.can_edit(p_org uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members
    where org_id = p_org and user_id = auth.uid() and role in ('organiser', 'staff')
  )
$$;

create or replace function public.is_organiser(p_org uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'organiser'
  )
$$;

-- Races (the PRD calls these Event) ---------------------------------------

create table public.races (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  race_date date not null,
  venue text not null default '',
  timezone text not null default 'Africa/Johannesburg',
  template_id text,
  status text not null default 'draft' check (status in ('draft', 'live', 'locked', 'archived')),
  judging_style text not null default 'follow' check (judging_style in ('follow', 'station')),
  start_style text not null default 'wave' check (start_style in ('mass', 'wave', 'interval', 'rolling')),
  splits_on boolean not null default false,
  disagree_threshold_ms integer not null default 2000,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);

create table public.divisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  race_id uuid not null,
  code text not null,
  label text not null,
  gender text check (gender in ('M', 'W', 'X')),
  age_min int,
  age_max int,
  weight_class text,
  level text check (level in ('open', 'pro')),
  unique (race_id, code),
  unique (id, org_id),
  unique (id, race_id),
  foreign key (race_id, org_id) references public.races(id, org_id) on delete cascade
);

create table public.segments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  race_id uuid not null,
  ord int not null,
  kind text not null check (kind in ('run', 'station', 'transition', 'rest')),
  name text not null,
  metric text not null check (metric in ('distance', 'reps', 'calories', 'time')),
  time_cap_s int,
  timed boolean not null default false,
  unique (race_id, ord),
  unique (id, org_id),
  foreign key (race_id, org_id) references public.races(id, org_id) on delete cascade
);

create table public.segment_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  segment_id uuid not null,
  division_id uuid not null,
  value numeric not null,
  weight numeric,
  unit text not null,
  unique (segment_id, division_id),
  foreign key (segment_id, org_id) references public.segments(id, org_id) on delete cascade,
  foreign key (division_id, org_id) references public.divisions(id, org_id) on delete cascade
);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  race_id uuid not null,
  division_id uuid not null,
  kind text not null check (kind in ('solo', 'team')),
  code text not null,
  display_name text not null,
  status text not null default 'entered'
    check (status in ('entered', 'checked_in', 'racing', 'finished', 'DNF', 'DNS', 'DSQ')),
  unique (race_id, code),
  unique (id, org_id),
  unique (id, race_id),
  foreign key (race_id, org_id) references public.races(id, org_id) on delete cascade,
  foreign key (division_id, race_id) references public.divisions(id, race_id)
);

create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  show_as_initials boolean not null default false,
  consent_waiver boolean not null default false,
  consent_public_results boolean not null default false,
  consent_at timestamptz,
  unique (id, org_id)
);

create table public.entry_members (
  org_id uuid not null,
  entry_id uuid not null,
  athlete_id uuid not null,
  relay_leg int,
  primary key (entry_id, athlete_id),
  foreign key (entry_id, org_id) references public.entries(id, org_id) on delete cascade,
  foreign key (athlete_id, org_id) references public.athletes(id, org_id) on delete cascade
);

create table public.heats (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  race_id uuid not null,
  number int not null,
  start_at timestamptz not null,
  unique (race_id, number),
  unique (id, org_id),
  unique (id, race_id),
  foreign key (race_id, org_id) references public.races(id, org_id) on delete cascade
);

create table public.heat_slots (
  org_id uuid not null,
  race_id uuid not null,
  heat_id uuid not null,
  lane int not null check (lane > 0),
  entry_id uuid not null,
  primary key (heat_id, lane),
  unique (entry_id),
  foreign key (heat_id, race_id) references public.heats(id, race_id) on delete cascade,
  foreign key (entry_id, race_id) references public.entries(id, race_id) on delete cascade,
  foreign key (race_id, org_id) references public.races(id, org_id) on delete cascade
);

-- Access links ------------------------------------------------------------
-- The token itself is never stored, only its SHA-256 hash.

create table public.access_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  race_id uuid not null,
  role text not null check (role in ('head_judge', 'judge', 'volunteer', 'helper')),
  label text not null default '',
  scope jsonb not null default '{}'::jsonb,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (race_id, org_id) references public.races(id, org_id) on delete cascade
);

-- Timing events: append only ----------------------------------------------

create table public.timing_events (
  id uuid primary key,
  org_id uuid not null,
  race_id uuid not null,
  device_id text not null,
  actor_link_id uuid not null,
  actor_role text not null check (actor_role in ('organiser', 'staff', 'head_judge', 'judge', 'volunteer')),
  entry_id uuid,
  device_ts bigint not null,
  tz_offset_min int not null default 0,
  seq int not null,
  server_ts bigint not null default public.now_ms(),
  server_seq bigserial not null unique,
  payload jsonb not null,
  foreign key (race_id, org_id) references public.races(id, org_id) on delete restrict,
  foreign key (entry_id, race_id) references public.entries(id, race_id),
  foreign key (actor_link_id, org_id) references public.access_links(id, org_id)
);
create index timing_events_race_seq on public.timing_events (race_id, server_seq);

-- Audit log: append only --------------------------------------------------

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  actor text not null,
  action text not null,
  target text not null,
  at timestamptz not null default now(),
  before jsonb,
  after jsonb
);

create or replace function public.forbid_change() returns trigger
  language plpgsql as $$
begin
  raise exception 'append_only: % rows can not be changed or deleted', tg_table_name;
end $$;

create trigger timing_events_append_only before update or delete on public.timing_events
  for each row execute function public.forbid_change();
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function public.forbid_change();

-- Row level security ------------------------------------------------------

alter table public.orgs enable row level security;
alter table public.org_members enable row level security;

create policy orgs_read on public.orgs for select using (public.is_member(id));
create policy orgs_update on public.orgs for update using (public.is_organiser(id)) with check (public.is_organiser(id));

create policy members_read on public.org_members for select using (public.is_member(org_id));
create policy members_write on public.org_members for all
  using (public.is_organiser(org_id)) with check (public.is_organiser(org_id));

-- Same rules for every race table: members read, organisers and staff write.
do $$
declare t text;
begin
  foreach t in array array['races', 'divisions', 'segments', 'segment_targets', 'entries', 'athletes',
                           'entry_members', 'heats', 'heat_slots', 'access_links']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (public.is_member(org_id))', t || '_read', t);
    execute format('create policy %I on public.%I for insert with check (public.can_edit(org_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (public.can_edit(org_id)) with check (public.can_edit(org_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete using (public.can_edit(org_id))', t || '_delete', t);
  end loop;
end $$;

alter table public.timing_events enable row level security;
create policy timing_events_read on public.timing_events for select using (public.is_member(org_id));
-- No insert policy: timing events arrive only through push_timing_events below.

alter table public.audit_log enable row level security;
create policy audit_log_read on public.audit_log for select using (public.is_organiser(org_id));

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.timing_events, public.audit_log from authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Org signup --------------------------------------------------------------

create or replace function public.create_org(p_name text, p_subdomain text) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  insert into orgs (name, subdomain) values (p_name, lower(p_subdomain)) returning id into v_org;
  insert into org_members (org_id, user_id, role) values (v_org, auth.uid(), 'organiser');
  insert into audit_log (org_id, actor, action, target) values (v_org, auth.uid()::text, 'org.create', v_org::text);
  return v_org;
end $$;

-- Access links ------------------------------------------------------------

create or replace function public.hash_token(p_token text) returns text
  language sql immutable as $$ select encode(sha256(convert_to(p_token, 'UTF8')), 'hex') $$;

-- Returns the token once. Only the hash is kept.
create or replace function public.create_access_link(
  p_race uuid, p_role text, p_label text, p_valid_hours int, p_scope jsonb default '{}'::jsonb
) returns text
  language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_token text;
  v_id uuid;
begin
  select org_id into v_org from races where id = p_race;
  if v_org is null or not can_edit(v_org) then raise exception 'not_allowed'; end if;
  if p_valid_hours not between 1 and 24 * 14 then raise exception 'bad_expiry'; end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into access_links (org_id, race_id, role, label, scope, token_hash, expires_at, created_by)
    values (v_org, p_race, p_role, coalesce(p_label, ''), coalesce(p_scope, '{}'::jsonb), hash_token(v_token),
            now() + make_interval(hours => p_valid_hours), auth.uid())
    returning id into v_id;
  insert into audit_log (org_id, actor, action, target) values (v_org, auth.uid()::text, 'link.create', v_id::text);
  return v_token;
end $$;

create or replace function public.revoke_access_link(p_link uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from access_links where id = p_link;
  if v_org is null or not can_edit(v_org) then raise exception 'not_allowed'; end if;
  update access_links set revoked_at = now() where id = p_link and revoked_at is null;
  insert into audit_log (org_id, actor, action, target) values (v_org, auth.uid()::text, 'link.revoke', p_link::text);
end $$;

-- Checked on every call, so a revoked link stops at the next sync.
create or replace function public.check_link(p_token text) returns public.access_links
  language plpgsql stable security definer set search_path = public as $$
declare v access_links;
begin
  select * into v from access_links where token_hash = hash_token(p_token);
  if v.id is null then raise exception 'link_unknown'; end if;
  if v.revoked_at is not null then raise exception 'link_revoked'; end if;
  if v.expires_at <= now() then raise exception 'link_expired'; end if;
  return v;
end $$;

create or replace function public.link_info(p_token text) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v access_links;
  r races;
begin
  v := check_link(p_token);
  select * into r from races where id = v.race_id;
  return jsonb_build_object('linkId', v.id, 'raceId', v.race_id, 'raceName', r.name, 'role', v.role,
                            'label', v.label, 'scope', v.scope, 'expiresAt', v.expires_at);
end $$;

-- Push and pull -----------------------------------------------------------
-- The race, org, role and link always come from the link, never from the phone.

create or replace function public.push_timing_events(p_token text, p_events jsonb)
  returns table (id uuid, server_ts bigint)
  language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v access_links;
  e jsonb;
begin
  v := check_link(p_token);
  if v.role not in ('head_judge', 'judge') then raise exception 'not_allowed'; end if;
  if jsonb_array_length(p_events) > 500 then raise exception 'too_many'; end if;

  for e in select * from jsonb_array_elements(p_events) loop
    if (e->>'raceId') is distinct from v.race_id::text then raise exception 'wrong_race'; end if;
    insert into timing_events (id, org_id, race_id, device_id, actor_link_id, actor_role, entry_id,
                               device_ts, tz_offset_min, seq, payload)
    values ((e->>'id')::uuid, v.org_id, v.race_id, left(e->>'deviceId', 64), v.id, v.role,
            nullif(e->>'entryId', '')::uuid, (e->>'deviceTs')::bigint,
            coalesce((e->>'tzOffsetMin')::int, 0), (e->>'seq')::int, e->'payload')
    on conflict on constraint timing_events_pkey do nothing;
  end loop;

  return query
    select t.id, t.server_ts from timing_events t
    where t.id in (select (x->>'id')::uuid from jsonb_array_elements(p_events) x)
      and t.race_id = v.race_id;
end $$;

create or replace function public.pull_timing_events(p_token text, p_after bigint default 0)
  returns setof jsonb
  language plpgsql stable security definer set search_path = public as $$
declare v access_links;
begin
  v := check_link(p_token);
  return query
    select jsonb_build_object(
      'id', t.id, 'raceId', t.race_id, 'deviceId', t.device_id, 'actorLinkId', t.actor_link_id,
      'actorRole', t.actor_role, 'entryId', t.entry_id, 'deviceTs', t.device_ts,
      'tzOffsetMin', t.tz_offset_min, 'seq', t.seq, 'serverTs', t.server_ts, 'serverSeq', t.server_seq,
      'payload', t.payload)
    from timing_events t
    where t.race_id = v.race_id and t.server_seq > p_after
    order by t.server_seq
    limit 2000;
end $$;

-- Everything a judge phone needs to run the race offline. Team names only, no athlete details.
create or replace function public.race_snapshot(p_token text) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v access_links;
  r races;
begin
  v := check_link(p_token);
  select * into r from races where id = v.race_id;
  return jsonb_build_object(
    'link', jsonb_build_object('id', v.id, 'role', v.role, 'label', v.label, 'scope', v.scope, 'expiresAt', v.expires_at),
    'race', jsonb_build_object('id', r.id, 'orgId', r.org_id, 'name', r.name, 'venue', r.venue, 'timezone', r.timezone,
                               'judgingStyle', r.judging_style, 'startStyle', r.start_style, 'splitsOn', r.splits_on,
                               'disagreeThresholdMs', r.disagree_threshold_ms, 'status', r.status),
    'divisions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code, 'label', d.label, 'gender', d.gender, 'level', d.level) order by d.code)
                           from divisions d where d.race_id = r.id), '[]'::jsonb),
    'segments', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'order', s.ord, 'kind', s.kind, 'name', s.name, 'metric', s.metric, 'timed', s.timed) order by s.ord)
                          from segments s where s.race_id = r.id), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'divisionId', e.division_id, 'kind', e.kind, 'code', e.code, 'displayName', e.display_name) order by e.code)
                         from entries e where e.race_id = r.id), '[]'::jsonb),
    'heats', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', h.id, 'number', h.number, 'startAt', (extract(epoch from h.start_at) * 1000)::bigint,
                         'slots', coalesce((select jsonb_agg(jsonb_build_object('lane', hs.lane, 'entryId', hs.entry_id) order by hs.lane)
                                            from heat_slots hs where hs.heat_id = h.id), '[]'::jsonb)) order by h.number)
                       from heats h where h.race_id = r.id), '[]'::jsonb)
  );
end $$;

revoke all on function public.create_org, public.create_access_link, public.revoke_access_link from public, anon;
grant execute on function public.create_org, public.create_access_link, public.revoke_access_link to authenticated;
revoke all on function public.check_link from public, anon, authenticated;
grant execute on function public.link_info, public.race_snapshot, public.push_timing_events, public.pull_timing_events to anon, authenticated;
