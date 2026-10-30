import type { User } from '@supabase/supabase-js'
import { LogOut, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { redirectError } from '@/lib/session'
import { saveWithGoogle, signInWithGoogle, signOut, supabase } from '@/lib/supabase'
import { accountState } from '../api'

// Something to tell the user after Google: an error, or a Google account that already has its own saved history
type Notice = { text: string; signIn: boolean }

/** Header control: an anonymous visitor saves their history by linking Google; a saved account shows it and Sign out. */
export function AccountButton() {
  const [user, setUser] = useState<User | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null))
    // Google's answer comes back in the URL; read it once, then clean the address bar
    const back = redirectError(location.href)
    if (back) {
      history.replaceState(null, '', location.pathname)
      setNotice(
        back.code === 'identity_already_exists'
          ? {
              text: "This Google account already has saved history. Sign in to it? This browser's unsaved history will be replaced.",
              signIn: true,
            }
          : { text: `Google sign-in did not finish: ${back.message}`, signIn: false },
      )
    }
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (notice) dialog.current?.showModal()
  }, [notice])

  const fail = (e: Error) => setNotice({ text: e.message, signIn: false })
  const state = accountState(user)

  return (
    <>
      {state === 'saved' ? (
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
      ) : (
        <Button variant="ghost" size="sm" onClick={() => saveWithGoogle().catch(fail)} title="Keep your docs and chats on any device">
          <UserRound />
          <span className="sr-only sm:not-sr-only">Save with Google</span>
        </Button>
      )}

      <dialog
        ref={dialog}
        onClose={() => setNotice(null)}
        aria-labelledby="account-title"
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border bg-card p-6 text-card-foreground shadow-lg backdrop:bg-black/50"
      >
        <h2 id="account-title" className="text-lg font-semibold tracking-tight">
          {notice?.signIn ? 'Sign in with Google' : 'Save with Google'}
        </h2>
        <p className={notice?.signIn ? 'mt-2 text-sm text-muted-foreground' : 'mt-2 text-sm text-destructive'} role="alert">
          {notice?.text}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => dialog.current?.close()}>
            {notice?.signIn ? 'Cancel' : 'Close'}
          </Button>
          {notice?.signIn && <Button onClick={() => signInWithGoogle().catch(fail)}>Sign in</Button>}
        </div>
      </dialog>
    </>
  )
}
