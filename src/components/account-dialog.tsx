import type { User } from '@supabase/supabase-js'
import { CircleCheck, CloudUpload, Eye, EyeOff, Loader2, LogOut } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { countHistory } from '@/lib/history'
import { saveHistory, signIn, signOut, supabase } from '@/lib/supabase'
import { accountState, historySummary } from '../api'

export type AccountMode = 'save' | 'signin'

/** The signed-in user, kept current: anonymous until the history is saved with an email and password. */
export function useAccount() {
  const [user, setUser] = useState<User | null>(null)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null))
    return () => data.subscription.unsubscribe()
  }, [])
  return { user, saved: accountState(user) === 'saved' }
}

/** Header control: "Save history" while the history lives in this browser only; once saved, an account menu. */
export function AccountMenu({ user, saved, onSave }: { user: User | null; saved: boolean; onSave: () => void }) {
  if (!saved) {
    return (
      <Button variant="outline" size="sm" onClick={onSave} title="Keep your docs and chats on any device">
        <CloudUpload />
        <span className="sr-only sm:not-sr-only">Save history</span>
      </Button>
    )
  }
  const email = user?.email ?? ''
  // Sign out sits behind a menu, away from the theme toggle, so it is never hit by accident
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Account: ${email}`}>
          <span aria-hidden className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold uppercase text-primary-foreground">
            {email[0]}
          </span>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-64 rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium" title={email}>
              {email}
            </p>
            <p className="text-xs text-muted-foreground">Your docs and chats are saved to this account.</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          {/* Reload so nothing of this account stays on screen */}
          <DropdownMenu.Item
            onSelect={() => signOut().then(() => location.reload())}
            className="flex min-h-11 cursor-default items-center gap-2 rounded-xl px-2.5 text-sm outline-none select-none data-[highlighted]:bg-accent sm:min-h-9"
          >
            <LogOut className="size-4" />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** Save history (same account, gains an email and password) or sign in to history saved earlier.
 *  `opens` changes each time the dialog opens, so it can count what this browser holds right then. */
export function AccountDialog({
  dialog,
  mode,
  setMode,
  opens,
}: {
  dialog: RefObject<HTMLDialogElement | null>
  mode: AccountMode
  setMode: (m: AccountMode) => void
  opens: number
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  // "3 docs and 2 chats" in this browser; empty when there are none or they could not be counted
  const [held, setHeld] = useState('')
  const emailInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!opens) return
    emailInput.current?.focus()
    countHistory()
      .then((c) => setHeld(historySummary(c)))
      .catch(() => setHeld(''))
  }, [opens])

  function reset() {
    setPassword('')
    setShowPassword(false)
    setBusy(false)
    setError('')
    setDone(false)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'save') {
        await saveHistory(email.trim(), password)
        setDone(true)
      } else {
        await signIn(email.trim(), password)
        // Another account: reload so its history replaces this browser's
        location.reload()
        return
      }
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  const save = mode === 'save'

  return (
    <dialog
      ref={dialog}
      onClose={reset}
      aria-labelledby="account-title"
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border bg-card p-6 text-card-foreground shadow-lg backdrop:bg-black/50"
    >
      {done ? (
        <div className="space-y-4" role="status">
          <CircleCheck className="size-8 text-success" aria-hidden />
          <div className="space-y-1">
            <h2 id="account-title" className="text-lg font-semibold tracking-tight">
              History saved
            </h2>
            <p className="text-sm text-muted-foreground">
              Sign in with <span className="font-medium break-all text-foreground">{email.trim()}</span> on any device to see your
              docs and chats.
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => dialog.current?.close()}>Done</Button>
          </div>
        </div>
      ) : (
        <Tabs
          value={mode}
          onValueChange={(v) => {
            setMode(v as AccountMode)
            setError('')
          }}
          className="gap-5"
        >
          <TabsList className="w-full">
            <TabsTrigger value="save" className="flex-1">
              Save history
            </TabsTrigger>
            <TabsTrigger value="signin" className="flex-1">
              Sign in
            </TabsTrigger>
          </TabsList>
          <TabsContent value={mode}>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1">
                <h2 id="account-title" className="text-lg font-semibold tracking-tight">
                  {save ? 'Save your history' : 'Sign in to your history'}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {save
                    ? held
                      ? `Keep your ${held}. Use this email and password to get them back on any device.`
                      : 'Use this email and password to get your docs and chats back on any device.'
                    : 'Use the email and password you saved your history with.'}
                </p>
              </div>
              {!save && held && (
                <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                  This browser has {held} that aren't saved. Signing in replaces them with your account's history.
                </p>
              )}
              <div className="space-y-1.5">
                <label htmlFor="account-email" className="block text-sm font-medium">
                  Email
                </label>
                <Input
                  ref={emailInput}
                  id="account-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={!!error}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="account-password" className="block text-sm font-medium">
                  Password
                </label>
                <div className="relative">
                  <Input
                    id="account-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    autoComplete={save ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={!!error}
                    aria-describedby={save ? 'account-password-hint' : undefined}
                    className="pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {save && (
                  <p id="account-password-hint" className="text-xs text-muted-foreground">
                    At least 6 characters.
                  </p>
                )}
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => dialog.current?.close()}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy && <Loader2 className="animate-spin" />}
                  {save ? (busy ? 'Saving…' : 'Save history') : busy ? 'Signing in…' : 'Sign in'}
                </Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>
      )}
    </dialog>
  )
}
