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

export async function saveGeneration(g: Omit<Generation, 'id' | 'createdAt'> & { executionId: string }): Promise<void> {
  await accessToken()
  const { error } = await supabase.from('generations').insert({
    repo: g.repo,
    status: g.status,
    markdown: g.markdown,
    preview: g.preview.length <= MAX_PREVIEW ? g.preview : null,
    execution_id: g.executionId,
  })
  if (error) throw new Error(error.message)
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
