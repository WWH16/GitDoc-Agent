-- Vector store for the n8n workflows "GitDoc - Index Supabase" (insert) and "GitDoc - Ask Repo (Supabase)" (search).
-- Run once in the Supabase SQL Editor of a new project.
-- 3072 dims = Gemini gemini-embedding-001, the default model of n8n's "Embeddings Google Gemini" node.
-- Change both 3072s if you switch embedding models, then re-index every repo.

create extension if not exists vector with schema extensions;

create table if not exists public.documents (
  id bigserial primary key,
  content text,
  metadata jsonb,
  embedding extensions.vector(3072)
);

-- n8n connects with the service_role key, which bypasses RLS. No policies = no access for anon/authenticated.
alter table public.documents enable row level security;

-- "Delete Old Rows" and every search filter on metadata->>repo
create index if not exists documents_repo_idx on public.documents ((metadata ->> 'repo'));
-- ponytail: no vector index (HNSW/IVFFlat cap at 2000 dims), so searches scan one repo's rows. Fine for a few
-- thousand chunks per repo; past that, index an expression cast to halfvec(3072) and use the same cast below.

create or replace function public.match_documents (
  query_embedding extensions.vector(3072),
  match_count int default null,
  filter jsonb default '{}'
) returns table (id bigint, content text, metadata jsonb, similarity float)
language sql stable
set search_path = public, extensions
as $$
  select id, content, metadata, 1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where metadata @> filter
  order by documents.embedding <=> query_embedding
  limit match_count;
$$;
