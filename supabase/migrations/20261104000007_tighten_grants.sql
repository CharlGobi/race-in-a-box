-- Supabase grants the anon role rights on every new table and sequence by
-- default. Row level security already blocks them, but visitors with no account
-- should not hold table rights at all. They reach data only through the link
-- and public results functions.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Signed in users write timing events and the audit log only through functions.
revoke insert, update, delete on public.timing_events, public.audit_log from authenticated;
-- Visitor sign ups arrive only through submit_visitor.
revoke insert, update on public.visitor_leads from authenticated;

-- Internal helpers that no client should call directly.
revoke all on function public.check_link(text), public.race_json(uuid), public.entry_json(uuid),
  public.set_entry_members(uuid, uuid, jsonb) from public, anon, authenticated;
