import { accessToken, supabase } from './supabase'

// One Ask chat per repository for each user. Row-level security limits every query to the signed-in user.
// `repo` is always a repoKey (src/api.ts).

// `text` is the raw answer sent back as history; chats saved before it existed only have `html`
export type Message = { role: 'user'; text: string } | { role: 'assistant'; html: string; text?: string; sources: string[] }

export async function loadChat(repo: string): Promise<{ sessionId: string; messages: Message[] } | null> {
  await accessToken()
  const { data, error } = await supabase.from('chats').select('session_id, messages').eq('repo', repo).maybeSingle()
  if (error) throw new Error(error.message)
  return data && { sessionId: data.session_id as string, messages: data.messages as Message[] }
}

export async function saveChat(repo: string, sessionId: string, messages: Message[]): Promise<void> {
  await accessToken()
  const { error } = await supabase
    .from('chats')
    .upsert({ repo, session_id: sessionId, messages, updated_at: new Date().toISOString() }, { onConflict: 'user_id,repo' })
  if (error) throw new Error(error.message)
}

export async function deleteChat(repo: string): Promise<void> {
  await accessToken()
  const { error } = await supabase.from('chats').delete().eq('repo', repo)
  if (error) throw new Error(error.message)
}
