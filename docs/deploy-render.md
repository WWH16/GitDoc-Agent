# Deploying to Render

[`render.yaml`](../render.yaml) creates two free Render web services:

| Service | What it runs | Data |
| --- | --- | --- |
| `gitdoc-n8n` | The `n8nio/n8n:2.32.6` image | Workflows, credentials and executions in Supabase Postgres, schema `n8n` |
| `gitdoc-web` | `vite preview`, which serves the build and runs the API guard (`server/guard.ts`) | None of its own |

The free plan has no disk, so n8n cannot keep its usual SQLite file. It uses the Supabase project the app already
uses, in its own `n8n` schema. That schema is not exposed through the Supabase Data API.

## Limits of the free plan

- **Sleep.** A service with no traffic for 15 minutes stops. The next request waits about a minute while it starts.
  Open both URLs a few minutes before a demo.
- **Hours.** 750 free instance hours a month cover one service running all month, not two.
- **Memory.** n8n gets 512 MB. Small repositories are fine; a large one can run n8n out of memory.
- **Database size.** n8n's tables share Supabase's 500 MB with the code vectors. n8n keeps executions for 72 hours and
  at most 200 of them.

## 1. Prepare Supabase

1. In the SQL Editor, run:

   ```sql
   create schema if not exists n8n;
   ```

2. Find the database password. If you do not know it, reset it under **Project Settings > Database**.
3. Open **Connect > Session pooler** and note the host (for example `aws-0-ap-southeast-1.pooler.supabase.com`) and the
   user (`postgres.<project-ref>`). Use the session pooler: Render cannot reach the direct host, which is IPv6 only.
4. Under **Authentication > URL Configuration**, add the web app's Render URL (for example
   `https://gitdoc-web.onrender.com`) to the redirect URLs, and make it the Site URL if sign-up emails should open the
   hosted app.

## 2. Create the services

1. Push the branch that holds `render.yaml` to GitHub.
2. In Render, choose **New > Blueprint** and connect the repository. Render shows the two services and asks for every
   `sync: false` value.
3. Fill in `gitdoc-n8n`:
   - `DB_POSTGRESDB_HOST`, `DB_POSTGRESDB_USER`, `DB_POSTGRESDB_PASSWORD` from step 1.
4. Fill in `gitdoc-web`:
   - `N8N_URL`: `https://gitdoc-n8n.onrender.com` (check the real URL after creation; Render adds a suffix when the name
     is taken).
   - `N8N_WEBHOOK_TOKEN`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
     `GITHUB_TOKEN`: the same values as in your local `.env`.
   - `N8N_API_KEY`: leave empty for now.
5. Create the Blueprint and wait for both deploys.
6. Copy `N8N_ENCRYPTION_KEY` from the `gitdoc-n8n` environment and keep it somewhere safe outside Render. Without it,
   the saved credentials cannot be read.

## 3. Set up n8n

1. Open the n8n URL and create the owner account at once. Whoever fills in that form first owns the instance.
2. Move the workflows and credentials from the local n8n (next section).
3. In n8n, open each of the four workflows and publish it. Then open **GitDoc - Ask Repo (Supabase) - Load Repo
   Code > Settings** and set its error workflow to **GitDoc - Error Log**.
4. Under **Settings > n8n API**, create an API key. Put it in `N8N_API_KEY` of `gitdoc-web`. Render deploys the app
   again.

## 4. Move the workflows and credentials

This copies the four live workflows and the six credentials they use, with their IDs, so `N8N_WORKFLOW_ID` and the
error workflow links stay valid. It runs on your machine, with the local n8n container (`n8n`) running.

1. Create `.env.render.local` in the project root. Files ending in `.local` are git-ignored.

   ```dotenv
   DB_TYPE=postgresdb
   DB_POSTGRESDB_HOST=<session pooler host>
   DB_POSTGRESDB_PORT=5432
   DB_POSTGRESDB_DATABASE=postgres
   DB_POSTGRESDB_USER=postgres.<project-ref>
   DB_POSTGRESDB_PASSWORD=<database password>
   DB_POSTGRESDB_SCHEMA=n8n
   DB_POSTGRESDB_SSL_ENABLED=true
   DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED=false
   N8N_ENCRYPTION_KEY=<the key from Render>
   ```

2. Export from the local n8n:

   ```bash
   docker exec n8n sh -c 'mkdir -p /tmp/migrate/wf && for id in WFZUYhnaVFYPtUeo fyi6x61Tl3mr9EpT wLVIxo4yjJvDwRTN u9iKBSEIHxq95lOO; do n8n export:workflow --id=$id --output=/tmp/migrate/wf/$id.json; done && n8n export:credentials --all --decrypted --output=/tmp/migrate/creds-all.json'
   ```

   ```bash
   docker cp n8n:/tmp/migrate ./migrate && docker exec n8n rm -rf /tmp/migrate
   ```

3. Keep only the credentials the live workflows use:

   ```bash
   node -e "const f='migrate/creds-all.json',fs=require('fs'),keep=['GitHub account','OpenRouter account','Groq account','Google Gemini(PaLM) Api account','Supabase account','Header Auth account'];fs.writeFileSync('migrate/creds.json',JSON.stringify(JSON.parse(fs.readFileSync(f)).filter(c=>keep.includes(c.name))));fs.rmSync(f)"
   ```

4. Import into the Render n8n's database:

   ```bash
   docker run --rm --env-file .env.render.local -v "$PWD/migrate:/migrate" docker.io/n8nio/n8n:2.32.6 import:credentials --input=/migrate/creds.json
   ```

   ```bash
   docker run --rm --env-file .env.render.local -v "$PWD/migrate:/migrate" docker.io/n8nio/n8n:2.32.6 import:workflow --separate --input=/migrate/wf
   ```

5. Delete the export. `creds.json` holds every key in plain text. (`migrate/` is git-ignored as a safeguard.)

   ```bash
   rm -rf migrate
   ```

## 5. Check it

1. Open the web app's Render URL, generate docs for a small public repository, and watch the steps.
2. Wait a few minutes for indexing, then ask a question in the Ask tab and check that it lists sources.
3. If something fails, look at **Logs** of each Render service and at the executions of **GitDoc - Error Log** in n8n.
