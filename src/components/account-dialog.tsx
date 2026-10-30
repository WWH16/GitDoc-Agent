import type { User } from '@supabase/supabase-js'
import { LogOut, UserRound } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { saveHistory, signInWithEmail, signOut, supabase } from '@/lib/supabase'
import { accountState } from '../api'

/** Header control: an anonymous visitor can save their history with an email; a saved account shows it and Sign out. */
export function AccountButton() {
  const [user, setUser] = useState<User | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null))
    return () => data.subscription.unsubscribe()
  }, [])

  const state = accountState(user)

  if (state === 'saved') {
    return (
      <div className="flex items-center gap-1">
        <span className="hidden max-w-48 truncate text-sm text-muted-foreground lg:inline" title={user?.email}>
          {user?.email}
        </span>
        {/* Reload so nothing of this account stays on screen */}
        <Button variant="ghost" size="sm" onClick={() => signOut().then(() => location.reload())}>
          <LogOut />
          <span className="sr-only sm:not-sr-only">Sign out</span>
        </Button>
      </div>
    )
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => dialog.current?.showModal()}>
        <UserRound />
        <span className="sr-only sm:not-sr-only">Save your history</span>
      </Button>
      <AccountDialog dialog={dialog} anonymous={state === 'anonymous'} />
    </>
  )
}

function AccountDialog({ dialog, anonymous }: { dialog: RefObject<HTMLDialogElement | null>; anonymous: boolean }) {
  const [mode, setMode] = useState<'save' | 'signin'>('save')
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  function reset() {
    setMode('save')
    setSending(false)
    setSent(false)
    setError('')
  }

  async function send(e: FormEvent) {
    e.preventDefault()
    setSending(true)
    setError('')
    try {
      await (mode === 'save' ? saveHistory(email.trim()) : signInWithEmail(email.trim()))
      setSent(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  const save = mode === 'save'

  return (
    <dialog
      ref={dialog}
      onClose={reset}
      aria-labelledby="account-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border bg-card p-6 text-card-foreground shadow-lg backdrop:bg-black/50"
    >
      <h2 id="account-title" className="text-lg font-semibold tracking-tight">
        {save ? 'Save your history' : 'Sign in'}
      </h2>
      {sent ? (
        <div className="mt-2 space-y-4">
          <p className="text-sm text-muted-foreground" role="status">
            Check your email for the link.
          </p>
          <div className="flex justify-end">
            <Button onClick={() => dialog.current?.close()}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={send} className="mt-2 space-y-4">
          <p className="text-sm text-muted-foreground">
            {save
              ? "We'll email you a sign-in link. Your docs and chats stay with your account on any device."
              : "We'll email you a sign-in link for the history you saved."}
          </p>
          {!save && anonymous && <p className="text-sm text-warning">This browser's unsaved history will be replaced.</p>}
          <div className="space-y-1.5">
            <label htmlFor="account-email" className="block text-sm font-medium">
              Email
            </label>
            <Input
              id="account-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!error}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="link" className="px-0" onClick={() => (setMode(save ? 'signin' : 'save'), setError(''))}>
              {save ? 'Already saved? Sign in' : 'Not saved yet? Save your history'}
            </Button>
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="ghost" onClick={() => dialog.current?.close()}>
                Cancel
              </Button>
              <Button type="submit" disabled={sending}>
                {save ? 'Send link' : 'Send sign-in link'}
              </Button>
            </div>
          </div>
        </form>
      )}
    </dialog>
  )
}
