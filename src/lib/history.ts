import { accessToken, supabase } from './supabase'

// Each user's generated docs. Row-level security limits every query to the signed-in user, so no user filter here.

export type Generation = { id: string; repo: string; status: string; createdAt: string; markdown: string; preview: string }

type Row = { id: string; repo: string; status: string; created_at: string; markdown?: string; preview?: string | null }

// Same limit as the check on generations.preview (docs/supabase-app.sql). A bigger preview is not kept; the docs then
// reopen from the markdown, with diagrams as code blocks.
const MAX_PREVIEW = 3_000_000

const toGeneration = (r: Row): Generation => ({
  id: r.id,
  repo: r.repo,
  status: r.status,
  createdAt: r.created_at,
  markdown: r.markdown ?? '',
  preview: r.preview ?? r.markdown ?? '',
})

/** Saves a run and returns its id. */
export async function saveGeneration(g: Omit<Generation, 'id' | 'createdAt'> & { executionId: string }): Promise<string> {
  await accessToken()
  const { data, error } = await supabase.from('generations').insert({
    repo: g.repo,
    status: g.status,
    markdown: g.markdown,
    preview: g.preview.length <= MAX_PREVIEW ? g.preview : null,
    execution_id: g.executionId,
  }).select('id').single()
  if (error) throw new Error(error.message)
  return data.id
}

/** The newest 20, without the docs themselves (loadGeneration fetches those). */
export async function listGenerations(): Promise<Generation[]> {
  await accessToken()
  const { data, error } = await supabase
    .from('generations')
    .select('id, repo, status, created_at')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw new Error(error.message)
  return (data as Row[]).map(toGeneration)
}

/** How many docs and chats this user has (for "Keep your 3 docs and 2 chats"). */
export async function countHistory(): Promise<{ docs: number; chats: number }> {
  await accessToken()
  const [docs, chats] = await Promise.all([
    supabase.from('generations').select('id', { count: 'exact', head: true }),
    supabase.from('chats').select('repo', { count: 'exact', head: true }),
  ])
  return { docs: docs.count ?? 0, chats: chats.count ?? 0 }
}

export async function loadGeneration(id: string): Promise<Generation> {
  await accessToken()
  const { data, error } = await supabase
    .from('generations')
    .select('id, repo, status, created_at, markdown, preview')
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return toGeneration(data as Row)
}
