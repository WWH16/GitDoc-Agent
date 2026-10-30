import type { User } from '@supabase/supabase-js'
import { CircleCheck, CloudUpload, Eye, EyeOff, KeyRound, Loader2, LogOut, MailCheck } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useEffect, useRef, useState, type ComponentProps, type FormEvent, type ReactNode, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { countHistory } from '@/lib/history'
import {
  refreshAccount,
  resendConfirmation,
  sendConfirmation,
  sendPasswordReset,
  setPassword as savePassword,
  signIn,
  signOut,
  supabase,
} from '@/lib/supabase'
import { accountState, historySummary, needsPassword } from '../api'

export type AccountMode = 'save' | 'signin'
// form → sent (check your email) → password → done; Sign in: form → reset-sent when the password was forgotten
export type AccountStep = 'form' | 'sent' | 'password' | 'reset-sent' | 'done'
/** Where the dialog opens: `message` shows as an error (a link that failed); `recovery` means a password reset. */
export type AccountStart = { mode: AccountMode; step: AccountStep; message?: string; recovery?: boolean }

/** The signed-in user, kept current. While a confirmation email is pending, coming back to the tab rechecks the user,
 *  so a link opened on another tab or device moves this tab on to the password step. */
export function useAccount() {
  const [user, setUser] = useState<User | null>(null)
  const [recovering, setRecovering] = useState(false)
  const current = useRef(user)
  current.current = user

  useEffect(() => {
    // The last account this tab showed. Another tab signing in to a different one (Supabase syncs tabs) would leave
    // this tab showing the old account's docs and chats, so it starts over. A sign-out in between does not reset it.
    let shown: string | null = null
    const track = (next: User | null) => {
      if (shown && next && next.id !== shown) location.reload()
      if (next) shown = next.id
      setUser(next)
    }
    supabase.auth.getSession().then(({ data }) => track(data.session?.user ?? null))
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      track(session?.user ?? null)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    })
    const recheck = () => {
      if (current.current?.is_anonymous && current.current.new_email) refreshAccount().catch(() => {})
    }
    addEventListener('focus', recheck)
    return () => {
      data.subscription.unsubscribe()
      removeEventListener('focus', recheck)
    }
  }, [])

  return { user, saved: accountState(user) === 'saved', needsPassword: needsPassword(user), recovering }
}

/** Header control: "Save history" while the history lives in this browser only; once saved, an account menu. */
export function AccountMenu({ user, saved, onOpen }: { user: User | null; saved: boolean; onOpen: (start: AccountStart) => void }) {
  if (!saved) {
    const pending = user?.new_email
    return (
      <Button
        variant="outline"
        size="sm"
        // A sent link is not lost by closing the dialog: this reopens on "Check your email"
        onClick={() => onOpen({ mode: 'save', step: pending ? 'sent' : 'form' })}
        title="Keep your docs and chats on any device"
      >
        <CloudUpload />
        <span className="sr-only sm:not-sr-only">{pending ? 'Confirm email' : 'Save history'}</span>
      </Button>
    )
  }
  const email = user?.email ?? ''
  const item =
    'flex min-h-11 cursor-default items-center gap-2 rounded-xl px-2.5 text-sm outline-none select-none data-[highlighted]:bg-accent sm:min-h-9'
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
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-64 rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-lg">
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium" title={email}>
              {email}
            </p>
            <p className="text-xs text-muted-foreground">Your docs and chats are saved to this account.</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          {needsPassword(user) && (
            <DropdownMenu.Item className={item} onSelect={() => onOpen({ mode: 'save', step: 'password' })}>
              <KeyRound className="size-4" />
              Choose a password
            </DropdownMenu.Item>
          )}
          {/* Reload so nothing of this account stays on screen */}
          <DropdownMenu.Item className={item} onSelect={() => signOut().then(() => location.reload())}>
            <LogOut className="size-4" />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** Save history in two steps (confirm the email, then choose a password), or sign in to history saved earlier.
 *  `opens` changes each time the dialog opens, with `start` saying where. */
export function AccountDialog({
  dialog,
  start,
  opens,
  user,
}: {
  dialog: RefObject<HTMLDialogElement | null>
  start: AccountStart
  opens: number
  user: User | null
}) {
  const [mode, setMode] = useState<AccountMode>(start.mode)
  const [step, setStep] = useState<AccountStep>(start.step)
  const [recovery, setRecovery] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // "3 docs and 2 chats" in this browser; empty when there are none or they could not be counted
  const [held, setHeld] = useState('')
  // Seconds until another confirmation email may be sent (Supabase allows one a minute)
  const [cooldown, setCooldown] = useState(0)
  const emailInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)

  // The address the flow is about: the one typed, else the account's (confirmed or waiting for confirmation)
  const address = email.trim() || user?.email || user?.new_email || ''

  useEffect(() => {
    if (!opens) return
    setMode(start.mode)
    setStep(start.step)
    setRecovery(!!start.recovery)
    setError(start.message ?? '')
    countHistory()
      .then((c) => setHeld(historySummary(c)))
      .catch(() => setHeld(''))
  }, [opens, start])

  // The field the step asks for gets the cursor
  useEffect(() => {
    if (step === 'form') emailInput.current?.focus()
    if (step === 'password') passwordInput.current?.focus()
  }, [step, mode, opens])

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  function reset() {
    setPassword('')
    setShowPassword(false)
    setBusy(false)
    setError('')
  }

  // Runs one call with the busy state and plain-words errors
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (step === 'password') {
      return run(async () => {
        await savePassword(password)
        setStep('done')
      })
    }
    if (mode === 'save') {
      return run(async () => {
        const result = await sendConfirmation(email.trim())
        setStep(result === 'sent' ? 'sent' : 'password')
        setCooldown(60)
      })
    }
    return run(async () => {
      await signIn(email.trim(), password)
      // Another account: reload so its history replaces this browser's
      location.reload()
    })
  }

  function forgot() {
    if (!email.trim()) {
      setError('Enter your email first, then choose "Forgot password?".')
      emailInput.current?.focus()
      return
    }
    run(async () => {
      await sendPasswordReset(email.trim())
      setStep('reset-sent')
    })
  }

  const close = () => dialog.current?.close()
  const save = mode === 'save'

  return (
    <dialog
      ref={dialog}
      onClose={reset}
      aria-labelledby="account-title"
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border bg-card p-6 text-card-foreground shadow-lg backdrop:bg-black/50"
    >
      {step === 'sent' && (
        <Panel icon={<MailCheck className="size-8 text-primary" aria-hidden />} stage="Step 1 of 2" title="Check your email">
          <p>
            We sent a link to <Strong>{address}</Strong>. Open it to confirm your email, then choose a password. Your docs and
            chats stay here while you wait.
          </p>
          <p>
            Didn't get it? Check your spam folder, or{' '}
            <LinkButton disabled={busy || cooldown > 0} onClick={() => run(() => resendConfirmation(address).then(() => setCooldown(60)))}>
              {cooldown > 0 ? `resend in ${cooldown} s` : 'resend the link'}
            </LinkButton>
            .
          </p>
          {error && <ErrorText>{error}</ErrorText>}
          <Actions>
            <Button variant="ghost" onClick={() => (setStep('form'), setMode('save'), setError(''))}>
              Use another email
            </Button>
            <Button onClick={close}>Close</Button>
          </Actions>
        </Panel>
      )}

      {step === 'reset-sent' && (
        <Panel icon={<MailCheck className="size-8 text-primary" aria-hidden />} title="Check your email">
          {/* Same answer whether or not the email has an account, so nobody can probe for accounts */}
          <p>
            If <Strong>{address}</Strong> has saved history, we sent it a link to choose a new password.
          </p>
          <Actions>
            <Button onClick={close}>Close</Button>
          </Actions>
        </Panel>
      )}

      {step === 'done' && (
        <Panel icon={<CircleCheck className="size-8 text-success" aria-hidden />} title={recovery ? 'Password changed' : 'History saved'}>
          <p>
            Sign in with <Strong>{address}</Strong> on any device to see your docs and chats.
          </p>
          <Actions>
            <Button onClick={close}>Done</Button>
          </Actions>
        </Panel>
      )}

      {(step === 'form' || step === 'password') && (
        <div className="space-y-5">
          {step === 'form' && (
            <Tabs
              value={mode}
              onValueChange={(v) => {
                setMode(v as AccountMode)
                setError('')
              }}
            >
              <TabsList className="w-full">
                <TabsTrigger value="save" className="flex-1">
                  Save history
                </TabsTrigger>
                <TabsTrigger value="signin" className="flex-1">
                  Sign in
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1">
              {step === 'password' && !recovery && <p className="text-xs font-medium text-muted-foreground">Step 2 of 2</p>}
              <h2 id="account-title" className="text-lg font-semibold tracking-tight">
                {step === 'password' ? (recovery ? 'Choose a new password' : 'Email confirmed') : save ? 'Save your history' : 'Sign in to your history'}
              </h2>
              <p className="text-sm text-muted-foreground">
                {step === 'password'
                  ? recovery
                    ? `Use it with ${address} from now on.`
                    : `Last step: choose a password to sign in with ${address} on any device.`
                  : save
                    ? `${held ? `Keep your ${held} on any device. ` : ''}Enter your email and we'll send a link to confirm it's yours.`
                    : 'Use the email and password you saved your history with.'}
              </p>
            </div>

            {step === 'form' && !save && held && (
              <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                This browser has {held} that aren't saved. Signing in replaces them with your account's history.
              </p>
            )}

            {step === 'form' && (
              <Field label="Email" id="account-email">
                <Input
                  ref={emailInput}
                  id="account-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={!!error && error !== start.message}
                />
              </Field>
            )}

            {(step === 'password' || !save) && (
              <Field
                label={step === 'password' ? 'New password' : 'Password'}
                id="account-password"
                aside={
                  step === 'form' && (
                    <LinkButton disabled={busy} onClick={forgot}>
                      Forgot password?
                    </LinkButton>
                  )
                }
              >
                <div className="relative">
                  <Input
                    ref={passwordInput}
                    id="account-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    autoComplete={step === 'password' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={!!error && error !== start.message}
                    aria-describedby={step === 'password' ? 'account-password-hint' : undefined}
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
                {step === 'password' && (
                  <p id="account-password-hint" className="text-xs text-muted-foreground">
                    At least 6 characters.
                  </p>
                )}
              </Field>
            )}

            {error && <ErrorText>{error}</ErrorText>}

            <Actions>
              <Button type="button" variant="ghost" onClick={close}>
                {step === 'password' ? 'Later' : 'Cancel'}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {step === 'password' ? 'Save password' : save ? 'Send link' : 'Sign in'}
              </Button>
            </Actions>
          </form>
        </div>
      )}
    </dialog>
  )
}

function Panel({ icon, stage, title, children }: { icon: ReactNode; stage?: string; title: string; children: ReactNode }) {
  return (
    <div className="space-y-4" role="status">
      {icon}
      <div className="space-y-1">
        {stage && <p className="text-xs font-medium text-muted-foreground">{stage}</p>}
        <h2 id="account-title" className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
      </div>
      <div className="space-y-3 text-sm text-muted-foreground">{children}</div>
    </div>
  )
}

function Field({ label, id, aside, children }: { label: string; id: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
        {aside}
      </div>
      {children}
    </div>
  )
}

const Strong = ({ children }: { children: ReactNode }) => <span className="font-medium break-all text-foreground">{children}</span>

const ErrorText = ({ children }: { children: ReactNode }) => (
  <p className="text-sm text-destructive" role="alert">
    {children}
  </p>
)

const Actions = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap justify-end gap-2 pt-1">{children}</div>

function LinkButton({ children, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...props}
      className="rounded-sm text-sm font-medium text-foreground underline underline-offset-4 outline-none hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:text-muted-foreground disabled:no-underline"
    >
      {children}
    </button>
  )
}
