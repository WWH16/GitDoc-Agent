# Anonymous Accounts, Private History and Rate Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every visitor gets an invisible anonymous account, sees only the docs, runs and chats they created, cannot exhaust the AI quota through `/api/*`, reuses docs already generated for an unchanged repo, and can save their history to an email account.

**Architecture:** Supabase Auth anonymous sign-in gives each browser a user and a JWT. The browser stores generations and per-repo chats in Supabase tables protected by row-level security. A small server-side guard in front of the `/api/*` proxy verifies the JWT and records each call in Supabase to enforce per-user and per-IP limits; it also replaces the raw n8n executions passthrough (which exposed every user's run data) with a `/api/progress` endpoint that returns only the caller's run timeline.

**Tech Stack:** React 19 + Vite 8 dev proxy, `@supabase/supabase-js` (new dependency), Supabase Postgres + Auth, n8n REST API, `node:test`.

**Spec:** Decisions made in chat on 2026-10-30, summarized in Global Constraints. Related: `docs/supabase-setup.sql` (vector store, already applied).

## Global Constraints

- Login: Supabase **anonymous** sign-in only. No sign-up form, no email, no password. Same browser = same user; another device, incognito or cleared site data = new user (accepted).
- Privacy: a user can read only their own `generations`, `chats` and run progress. Enforced by RLS in the database, not only by the UI.
- Secrets stay server-side: `SUPABASE_SERVICE_ROLE_KEY` and every `N8N_*` value have no `VITE_` prefix. The browser receives only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Rate limits (per rolling window; deny with HTTP 429 and `Retry-After`):
  - `generate`: 5 per user per hour, 15 per user per day, 10 per IP per hour
  - `ask`: 30 per user per hour, 60 per IP per hour
  - `progress`: 40 per user per minute
- No auth or an invalid token on any `/api/*` route → HTTP 401 `{ "error": "Sign-in expired. Reload the page." }`.
- Pinecone stays out of the live path; do not touch the Pinecone workflows (presentation story).
- One commit per task, Conventional Commits, one-line message, **no `Co-Authored-By` trailer**.
- Tests: `node:test`; `npm test` must run `src/*.test.ts` and `server/*.test.ts`.

## User setup (before Task 2; the implementer cannot do these)

1. Supabase dashboard → Authentication → Sign In / Providers → **Allow anonymous sign-ins: on**.
2. Supabase SQL Editor → run `docs/supabase-app.sql` (Task 1).
3. Add to `.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (Project Settings → API Keys → publishable), `SUPABASE_SERVICE_ROLE_KEY` (secret key `sb_secret_…` or legacy service_role). Optional: `GITHUB_TOKEN` (raises GitHub's 60 requests/hour limit for Task 7).
4. Before Task 8: Supabase → Authentication → URL Configuration → add `http://localhost:5173/app/` to Redirect URLs.

## Review Focus

- **Many anonymous accounts from one machine** to dodge per-user limits: the per-IP rules must still deny (Task 3 test `denies by ip across users`). Supabase's own anonymous sign-in limit per IP is the outer layer.
- **Guessing another user's run:** `/api/progress` with a random or someone else's `runId` must return 404 and never execution data (Task 4 test `unknown runId is 404`).
- **Huge payloads written straight to Supabase** from the browser: table CHECK constraints reject oversized `markdown`/`messages` (Task 1 SQL; Task 5/6 surface the error as a normal message).
- **Expired or missing session** mid-use (tab open for days): every `/api/*` call refreshes the session first; a 401 shows the reload message instead of a blank failure (Task 2 test `401 maps to sign-in message`).
- **Supabase down or slow:** the guard must fail closed for `generate`/`ask` (503 `{ "error": "Rate limiter unavailable. Try again shortly." }`), so the quota cannot be spent unchecked (Task 3 test `limiter error is 503`).

---

### Task 1: Database schema, RLS and rate-limit function

**Files:**
- Create: `docs/supabase-app.sql`

**Interfaces:**
- Produces (tables, all in `public`, RLS on):
  - `generations(id uuid pk default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade, repo text not null, markdown text not null, preview text, status text not null, execution_id text, created_at timestamptz not null default now())`, CHECK `length(markdown) <= 500000`, `length(preview) <= 3000000`; index on `(user_id, created_at desc)`.
  - `chats(user_id uuid not null default auth.uid() references auth.users on delete cascade, repo text not null, session_id uuid not null, messages jsonb not null default '[]', updated_at timestamptz not null default now(), primary key (user_id, repo))`, CHECK `octet_length(messages::text) <= 1000000`.
  - `api_calls(id bigserial pk, user_id uuid, ip text, kind text not null, at timestamptz not null default now())`, index on `(kind, at)`. No policies (service role only).
  - `docs_cache(repo text, tree_sha text, markdown text not null, preview text, created_at timestamptz not null default now(), primary key (repo, tree_sha))`, no policies (service role only; used by Task 7).
  - Function `public.rate_limit_hit(p_user uuid, p_ip text, p_kind text, p_rules jsonb) returns text`: `p_rules` is `[{"scope":"user"|"ip","limit":int,"window":"1 hour"}]`. Returns the first violated rule's `window` text, or `null` after inserting one `api_calls` row. Also deletes `api_calls` rows older than 1 day.

- [ ] **Step 1: Write `docs/supabase-app.sql`**

Policies for `generations` and `chats`: `select`, `insert`, `delete` (and `update` on `chats`, with both `using` and `with check`), each `to authenticated` with `(select auth.uid()) = user_id`. `grant select, insert, update, delete` on both tables `to authenticated` (new tables may not be exposed to the Data API by default). `rate_limit_hit`: `language plpgsql`, `set search_path = public`, `revoke execute … from public, anon, authenticated`, `grant execute … to service_role`.

- [ ] **Step 2: User runs the file in the Supabase SQL Editor**

Expected: "Success. No rows returned".

- [ ] **Step 3: Verify RLS and the function**

In the SQL Editor:
```sql
select relname, relrowsecurity from pg_class where relname in ('generations','chats','api_calls','docs_cache');
select public.rate_limit_hit(gen_random_uuid(), '1.1.1.1', 'test', '[{"scope":"ip","limit":1,"window":"1 hour"}]');  -- null
select public.rate_limit_hit(gen_random_uuid(), '1.1.1.1', 'test', '[{"scope":"ip","limit":1,"window":"1 hour"}]');  -- '1 hour'
delete from public.api_calls where kind = 'test';
```
Expected: all four `relrowsecurity = true`; the two calls return `null` then `1 hour`.

- [ ] **Step 4: Commit**

```bash
git add docs/supabase-app.sql
git commit -m "feat(db): add private generations, chats and api rate-limit schema"
```

### Task 2: Anonymous session in the browser and authenticated API calls

**Files:**
- Create: `src/lib/supabase.ts`
- Modify: `src/api.ts` (`post`, `executions` callers), `package.json` (dependency `@supabase/supabase-js`, pinned exact), `.env.example`-style note in `README.md`
- Test: `src/api.test.ts`

**Interfaces:**
- Produces: `supabase` (the client, `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY)`); `accessToken(): Promise<string>` — returns the current session's access token, signing in anonymously first when there is no session.
- `api.ts` gains `setTokenSource(fn: () => Promise<string>)` so tests can inject a token; every `/api/*` request sends `Authorization: Bearer <token>`.
- A 401 response throws `Error('Sign-in expired. Reload the page.')`.

- [ ] **Step 1: Write the failing tests**

```ts
test('api calls carry the bearer token', async () => {
  setTokenSource(async () => 'tok')
  let auth = ''
  globalThis.fetch = async (_u, init) => { auth = new Headers(init?.headers).get('Authorization') ?? ''; return new Response('{"answer":"a","sources":[]}') }
  await askRepo('r', 'q', 's')
  assert.equal(auth, 'Bearer tok')
})
test('401 maps to sign-in message', async () => {
  reply(401, { error: 'whatever' })
  await assert.rejects(askRepo('r', 'q', 's'), /^Error: Sign-in expired\. Reload the page\.$/)
})
```

- [ ] **Step 2: Run `npm test`** — Expected: both FAIL.
- [ ] **Step 3: Implement** `setTokenSource` and the header in `post` and in the progress fetch; `src/lib/supabase.ts` with `accessToken()` (uses `supabase.auth.getSession()`, then `signInAnonymously()` if null). Wire `setTokenSource(accessToken)` once in `src/main.tsx`.
- [ ] **Step 4: Run `npm test` and `npx tsc -b`** — Expected: all PASS.
- [ ] **Step 5: Manual check** — `npm run dev`, open `/app/`; Supabase dashboard → Authentication → Users shows one anonymous user; reloading does not create a second.
- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase.ts src/api.ts src/api.test.ts src/main.tsx package.json package-lock.json README.md
git commit -m "feat(auth): sign visitors in anonymously and send their token to the api"
```

### Task 3: Server guard with authentication and rate limits

**Files:**
- Create: `server/guard.ts`, `server/guard.test.ts`
- Modify: `vite.config.ts` (register the guard plugin before the proxy), `tsconfig.node.json` (`include` adds `server/*.ts`), `package.json` (`test`: `node --test src/*.test.ts server/*.test.ts`)

**Interfaces:**
- Produces: `RULES: Record<'generate' | 'ask' | 'progress', Rule[]>` with the Global Constraints values; `type Rule = { scope: 'user' | 'ip'; limit: number; window: string }`.
- `guard(req: { path: string; ip: string; authorization: string | null }, deps: { verify(token: string): Promise<string | null>; hit(user: string, ip: string, kind: string, rules: Rule[]): Promise<string | null> }): Promise<{ status: number; body: { error: string }; retryAfter?: number } | { user: string }>` — pure decision function; `/api/generate` → kind `generate`, `/api/ask` → `ask`, `/api/progress` and `/api/executions` → `progress` (`/api/executions` stays only until Task 5 removes it); any other `/api/*` path → 404.
- `guardPlugin(): Plugin` — Vite plugin; `configureServer` adds middleware on `/api` that builds real deps (`supabase.auth.getUser(token)` with the service-role client; `supabase.rpc('rate_limit_hit', …)`), returns the error response, or calls `next()` so the existing proxy forwards. IP from `x-forwarded-for` first value, else socket address. `Retry-After` seconds: `3600` for an hour window, `86400` for a day, `60` for a minute.

- [ ] **Step 1: Write the failing tests** (`server/guard.test.ts`)

```ts
test('no token is 401', async () => assert.equal((await guard({ path: '/api/ask', ip: 'i', authorization: null }, deps())).status, 401))
test('allowed call passes with the user id', async () => assert.deepEqual(await guard(req('/api/ask'), deps()), { user: 'u1' }))
test('over the user limit is 429 with Retry-After', async () => {
  const r = await guard(req('/api/generate'), deps({ hit: async () => '1 hour' }))
  assert.equal(r.status, 429); assert.equal(r.retryAfter, 3600)
})
test('denies by ip across users', async () => {
  let rules: Rule[] = []
  await guard(req('/api/generate'), deps({ hit: async (_u, _i, _k, r) => { rules = r; return null } }))
  assert.ok(rules.some((x) => x.scope === 'ip' && x.limit === 10))
})
test('limiter error is 503', async () => assert.equal((await guard(req('/api/ask'), deps({ hit: async () => { throw new Error('down') } }))).status, 503))
test('unknown api path is 404', async () => assert.equal((await guard(req('/api/other'), deps())).status, 404))
```
(`req(path)` builds `{ path, ip: '1.2.3.4', authorization: 'Bearer t' }`; `deps(over)` returns `verify: async () => 'u1'`, `hit: async () => null` merged with `over`.)

- [ ] **Step 2: Run `npm test`** — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `server/guard.ts`** and register `guardPlugin()` in `vite.config.ts`; keep the existing proxy entries.
- [ ] **Step 4: Run `npm test`, `npx tsc -b`** — Expected: PASS.
- [ ] **Step 5: Manual check** — `curl -X POST localhost:5173/api/ask` → 401; the app still answers a question.
- [ ] **Step 6: Commit**

```bash
git add server/ vite.config.ts tsconfig.node.json package.json
git commit -m "feat(api): require a session and rate-limit generate, ask and progress"
```

### Task 4: Private run progress

**Files:**
- Create: `src/progress.ts` (move `timeline`, `TaskData`, `NodeRun`, `Progress` from `src/api.ts`)
- Modify: `server/guard.ts` (serve `/api/progress` itself), `src/api.ts` (`getProgress(runId)`, delete `latestFinishedId`; `getHistory` stays until Task 5), `src/App.tsx` (`generate()` sends `runId`, polls `getProgress(runId)` until status is not `running`), `src/api.test.ts`, `server/guard.test.ts`

**Interfaces:**
- Consumes: `guard` from Task 3.
- Produces: `progressFor(runId: string, list: (query: string) => Promise<Execution[]>): Promise<Progress | null>` in `server/guard.ts` — reads running executions, then the 5 newest finished ones (both `includeData=true`), and returns the timeline of the one whose `Webhook` node output `json.body.runId === runId`, else `null`. Response JSON is `Progress` only: `{ id, status, error, nodes }`, never file contents.
- `callWorkflow(repo: string, runId: string)` sends `{ repo, runId }`; n8n needs no change (the Webhook node already exposes the body).
- `getProgress(runId: string): Promise<Progress | null>` (404 → `null`).

- [ ] **Step 1: Write the failing tests**

```ts
test('progress returns only the matching run timeline', async () => {
  const p = await progressFor('r1', async () => [exec('7', 'r2'), exec('8', 'r1')])
  assert.equal(p?.id, '8'); assert.ok(!JSON.stringify(p).includes('content'))
})
test('unknown runId is 404', async () => assert.equal(await progressFor('nope', async () => [exec('7', 'r2')]), null))
```
(`exec(id, runId)` builds an execution whose `runData.Webhook[0].data.main[0][0].json.body.runId = runId`, plus a node with a file `content` field.)

- [ ] **Step 2: Run `npm test`** — Expected: FAIL.
- [ ] **Step 3: Implement**, deleting the single-user `ponytail:` assumption in `generate()` and the now-unused `latestFinishedId` test.
- [ ] **Step 4: Run `npm test`, `npx tsc -b`** — Expected: PASS.
- [ ] **Step 5: Manual check** — Generate on `https://github.com/WWH16/dss`: the node list moves live and ends on `Load Code into Supabase` with status Success; `curl localhost:5173/api/progress?runId=x -H "Authorization: Bearer <valid>"` → 404.
- [ ] **Step 6: Commit**

```bash
git add src/progress.ts src/api.ts src/api.test.ts src/App.tsx server/
git commit -m "fix(api): show each user only their own run progress"
```

### Task 5: Private docs history

**Files:**
- Create: `src/lib/history.ts`
- Modify: `src/App.tsx` (`Generate` saves on finish; `History` lists the user's generations; App lifts `opened: Generation | null` so History can reopen docs in the Generate tab; remove the `gitdoc:last-run` localStorage restore), `src/api.ts` (delete `getHistory` and the `Run` type), `server/guard.ts` and `vite.config.ts` (remove the `/api/executions` route and proxy entry; it now returns 404)

**Interfaces:**
- Produces: `type Generation = { id: string; repo: string; status: string; createdAt: string; markdown: string; preview: string }`; `saveGeneration(g: Omit<Generation, 'id' | 'createdAt'> & { executionId: string }): Promise<void>`; `listGenerations(): Promise<Generation[]>` (newest 20, select without `markdown`/`preview`); `loadGeneration(id: string): Promise<Generation>`.
- History table columns: Repository, Status, Created, and an **Open** button (replaces the n8n executions table and the Duration column).

- [ ] **Step 1: Implement `src/lib/history.ts`** with the Supabase client from Task 2 (RLS scopes rows to the user; no `user_id` filter in code).
- [ ] **Step 2: Wire `Generate`**: after the run finishes (`done` or `partial`), call `saveGeneration`; on failure show `Couldn't save this run to your history.` under the form without losing the docs.
- [ ] **Step 3: Wire `History`**: load on tab open and after each saved run; **Open** loads the markdown, renders it and switches to the Generate tab.
- [ ] **Step 4: Run `npx tsc -b`, `npm test`** — Expected: PASS.
- [ ] **Step 5: Manual check in two browsers** (normal and incognito = two anonymous users): generate in one; the other's Run history stays empty.
- [ ] **Step 6: Commit**

```bash
git add src/lib/history.ts src/App.tsx src/api.ts server/guard.ts vite.config.ts
git commit -m "feat(history): keep each user's generated docs private and reopenable"
```

### Task 6: Private per-repo chats

**Files:**
- Create: `src/lib/chats.ts`
- Modify: `src/App.tsx` (`Ask` loads and saves the chat for the current repo; replaces the `gitdoc:ask-messages` and `gitdoc:ask-session` localStorage state)

**Interfaces:**
- Produces: the `Message` type moves here from `src/App.tsx` (App imports it, so there is no import cycle); `loadChat(repo: string): Promise<{ sessionId: string; messages: Message[] } | null>`; `saveChat(repo: string, sessionId: string, messages: Message[]): Promise<void>` (upsert on `(user_id, repo)`); `deleteChat(repo: string): Promise<void>` (New chat).
- Repo key: the URL normalized as in n8n (`trim`, lowercase, no `.git`, no trailing `/`), exported as `repoKey(url: string): string` and unit-tested.

- [ ] **Step 1: Write the failing test** (`src/api.test.ts` or a new `src/chats.test.ts` importing only `repoKey`)

```ts
test('repoKey normalizes like the workflows', () => {
  assert.equal(repoKey(' https://github.com/WWH16/DSS.git/ '), 'https://github.com/wwh16/dss')
})
```
- [ ] **Step 2: Run `npm test`** — Expected: FAIL.
- [ ] **Step 3: Implement** `src/lib/chats.ts`; in `Ask`, load the chat when the repo key changes (debounced 400 ms so typing a URL does not load per keystroke), save after each answer, `deleteChat` on New chat.
- [ ] **Step 4: Run `npm test`, `npx tsc -b`** — Expected: PASS.
- [ ] **Step 5: Manual check** — chat on repo A, switch the URL to repo B (empty chat), switch back to A (chat returns); an incognito window sees neither.
- [ ] **Step 6: Commit**

```bash
git add src/lib/chats.ts src/App.tsx src/*.test.ts
git commit -m "feat(ask): keep a private chat per repository for each user"
```

### Task 7: Shared docs cache (no AI cost for a repo state someone already generated)

**Files:**
- Modify: `server/guard.ts` (serve `/api/generate` itself instead of proxying), `vite.config.ts` (drop the `/api/generate` proxy entry), `src/api.ts` (`callWorkflow` accepts `fresh` and returns `cached`), `src/App.tsx` (skip progress polling on a cached result; **Regenerate** button on the docs card), `server/guard.test.ts`

**Interfaces:**
- Consumes: `docs_cache` from Task 1.
- `treeSha(owner: string, repo: string): Promise<string | null>` — `GET https://api.github.com/repos/{owner}/{repo}/git/trees/HEAD`, header `Authorization: Bearer ${GITHUB_TOKEN}` only when that optional env var is set; returns the tree `sha` (same file content ⇒ same sha), `null` on any error.
- `generate(body: { repo: string; runId: string; fresh?: boolean }, deps: { tree(repo: string): Promise<string | null>; cacheGet(repo: string, sha: string): Promise<{ markdown: string; preview: string } | null>; cachePut(repo: string, sha: string, doc: { markdown: string; preview: string }): Promise<void>; limit(): Promise<GuardError | null>; n8n(body: object): Promise<Response> }): Promise<{ status: number; body: object }>` — order: tree sha → cache hit (and not `fresh`) returns `{ markdown, preview, cached: true }` **without** consuming the generate limit → else `limit()` → n8n → on 200 with a `markdown` string, `cachePut` (errors ignored) → return n8n's body.
- `callWorkflow(repo: string, runId: string, fresh = false): Promise<Result & { cached: boolean }>`.

- [ ] **Step 1: Write the failing tests**

```ts
test('cache hit skips the limit and n8n', async () => {
  let called = 0
  const r = await generate({ repo: 'https://github.com/a/b', runId: 'r' }, gdeps({ cacheGet: async () => ({ markdown: 'm', preview: 'p' }), limit: async () => { called++; return null }, n8n: async () => { called++; return new Response('{}') } }))
  assert.deepEqual(r.body, { markdown: 'm', preview: 'p', cached: true }); assert.equal(called, 0)
})
test('fresh bypasses the cache and stores the new docs', async () => {
  let stored = ''
  await generate({ repo: 'https://github.com/a/b', runId: 'r', fresh: true }, gdeps({ cacheGet: async () => ({ markdown: 'old', preview: '' }), cachePut: async (_r, _s, d) => { stored = d.markdown } , n8n: async () => new Response('{"markdown":"new","preview":"p"}') }))
  assert.equal(stored, 'new')
})
test('no tree sha means no cache, normal run', async () => {
  const r = await generate({ repo: 'https://github.com/a/b', runId: 'r' }, gdeps({ tree: async () => null, n8n: async () => new Response('{"markdown":"m"}') }))
  assert.equal((r.body as { markdown: string }).markdown, 'm')
})
```
(`gdeps(over)` defaults: `tree: async () => 'sha1'`, `cacheGet: async () => null`, `cachePut: async () => {}`, `limit: async () => null`, `n8n: async () => new Response('{"markdown":"m","preview":"p"}')`.)

- [ ] **Step 2: Run `npm test`** — Expected: FAIL.
- [ ] **Step 3: Implement**; the docs card shows `Loaded from cache` under the title for a cached result, and **Regenerate** runs with `fresh: true`.
- [ ] **Step 4: Run `npm test`, `npx tsc -b`** — Expected: PASS.
- [ ] **Step 5: Manual check** — Generate `WWH16/dss` twice: the second returns in about 1 s with `Loaded from cache` and no new n8n execution; **Regenerate** runs the workflow again.
- [ ] **Step 6: Commit**

```bash
git add server/ vite.config.ts src/api.ts src/App.tsx
git commit -m "feat(api): reuse docs for an unchanged repo instead of paying for a new run"
```

### Task 8: "Save your history" — turn the anonymous account into an email account

**Files:**
- Create: `src/components/account-dialog.tsx`
- Modify: `src/lib/supabase.ts`, `src/App.tsx` (header button)

**Interfaces:**
- Produces: `accountState(user: { is_anonymous?: boolean; email?: string } | null): 'none' | 'anonymous' | 'saved'` (pure, unit-tested); `saveHistory(email: string): Promise<void>` = `supabase.auth.updateUser({ email }, { emailRedirectTo: location.origin + '/app/' })` (same user id, so every generation and chat is kept); `signInWithEmail(email: string): Promise<void>` = `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: … } })` for another device; `signOut()`.
- Header: anonymous → **Save your history**; saved → the email and **Sign out**. Dialog copy: title `Save your history`, body `We'll email you a sign-in link. Your docs and chats stay with your account on any device.`, button `Send link`, then `Check your email for the link.`; a second mode `Already saved? Sign in` with button `Send sign-in link`. Signing in on a browser that has its own anonymous history shows `This browser's unsaved history will be replaced.` before sending.

- [ ] **Step 1: Write the failing test**

```ts
test('accountState tells anonymous from saved users', () => {
  assert.equal(accountState(null), 'none')
  assert.equal(accountState({ is_anonymous: true }), 'anonymous')
  assert.equal(accountState({ is_anonymous: false, email: 'a@b.c' }), 'saved')
})
```
- [ ] **Step 2: Run `npm test`** — Expected: FAIL.
- [ ] **Step 3: Implement** the helpers and dialog (native `<dialog>`, `<input type="email" required>`, existing `Button`); errors from Supabase show in the dialog in plain words.
- [ ] **Step 4: Run `npm test`, `npx tsc -b`** — Expected: PASS.
- [ ] **Step 5: Manual check** (needs user setup: Supabase → Authentication → URL Configuration → add `http://localhost:5173/app/` to Redirect URLs) — save with a real email, click the link: same history, header shows the email; open an incognito window, **Sign in** with that email: the same history appears.
- [ ] **Step 6: Commit**

```bash
git add src/components/account-dialog.tsx src/lib/supabase.ts src/App.tsx src/*.test.ts
git commit -m "feat(auth): let users save their history with an email sign-in link"
```

## Out of scope (follow-ups, not in this plan)

- Google sign-in, a branded sender address (needs a domain), CAPTCHA on anonymous sign-in.
- Moving the guard to Vercel Functions at deployment (the guard is written as plain functions so it can be reused there).
