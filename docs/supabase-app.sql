-- App data for the web app: each visitor's private docs and chats, the shared docs cache, and API rate limits.
-- Run once in the Supabase SQL Editor (after docs/supabase-setup.sql). Safe to re-run.
-- Visitors are Supabase anonymous users; they carry the `authenticated` role, so policies target `authenticated`
-- and scope rows with auth.uid(). The server (n8n proxy guard) uses the service role, which bypasses RLS.

-- Docs each user generated. Only the owner can see them.
create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  repo text not null,
  markdown text not null check (length(markdown) <= 500000),
  preview text check (length(preview) <= 3000000),
  status text not null,
  execution_id text,
  created_at timestamptz not null default now()
);
create index if not exists generations_user_created_idx on public.generations (user_id, created_at desc);

-- One chat per user and repository.
create table if not exists public.chats (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  repo text not null,
  session_id uuid not null,
  messages jsonb not null default '[]' check (octet_length(messages::text) <= 1000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, repo)
);

alter table public.generations enable row level security;
alter table public.chats enable row level security;

drop policy if exists "own generations: read" on public.generations;
drop policy if exists "own generations: add" on public.generations;
drop policy if exists "own generations: remove" on public.generations;
create policy "own generations: read" on public.generations for select to authenticated using ((select auth.uid()) = user_id);
create policy "own generations: add" on public.generations for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own generations: remove" on public.generations for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "own chats: read" on public.chats;
drop policy if exists "own chats: add" on public.chats;
drop policy if exists "own chats: change" on public.chats;
drop policy if exists "own chats: remove" on public.chats;
create policy "own chats: read" on public.chats for select to authenticated using ((select auth.uid()) = user_id);
create policy "own chats: add" on public.chats for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own chats: change" on public.chats for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own chats: remove" on public.chats for delete to authenticated using ((select auth.uid()) = user_id);

-- New tables may not be exposed to the Data API by default; RLS above still limits rows to their owner.
grant select, insert, update, delete on public.generations, public.chats to authenticated;

-- Server-only tables: RLS on with no policies, and no grants for browser roles.
create table if not exists public.api_calls (
  id bigserial primary key,
  user_id uuid,
  ip text,
  kind text not null,
  at timestamptz not null default now()
);
create index if not exists api_calls_kind_at_idx on public.api_calls (kind, at);
create index if not exists api_calls_kind_user_at_idx on public.api_calls (kind, user_id, at);
create index if not exists api_calls_kind_ip_at_idx on public.api_calls (kind, ip, at);
create index if not exists api_calls_at_idx on public.api_calls (at);

-- Docs already generated for a repository state (tree sha), reused for every user instead of a new AI run.
create table if not exists public.docs_cache (
  repo text not null,
  tree_sha text not null,
  markdown text not null check (length(markdown) <= 500000),
  preview text check (length(preview) <= 3000000),
  created_at timestamptz not null default now(),
  primary key (repo, tree_sha)
);

alter table public.api_calls enable row level security;
alter table public.docs_cache enable row level security;
revoke all on public.api_calls, public.docs_cache from anon, authenticated;

-- Records one call of `p_kind` and returns null, or returns the `window` of the first rule already at its limit
-- (nothing recorded). Rules: [{"scope":"user"|"ip","limit":5,"window":"1 hour"}]. Calls older than a day are pruned.
create or replace function public.rate_limit_hit(p_user uuid, p_ip text, p_kind text, p_rules jsonb)
returns text
language plpgsql
set search_path = public
as $$
declare
  rule jsonb;
  used int;
begin
  delete from api_calls where at < now() - interval '1 day';
  for rule in select * from jsonb_array_elements(p_rules) loop
    select count(*) into used from api_calls
    where kind = p_kind
      and at > now() - (rule->>'window')::interval
      and case rule->>'scope' when 'user' then user_id = p_user else ip = p_ip end;
    if used >= (rule->>'limit')::int then
      return rule->>'window';
    end if;
  end loop;
  insert into api_calls (user_id, ip, kind) values (p_user, p_ip, p_kind);
  return null;
end;
$$;

revoke execute on function public.rate_limit_hit(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(uuid, text, text, jsonb) to service_role;
