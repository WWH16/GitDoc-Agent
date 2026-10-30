# Doc Agent web

React frontend for the GitHub Doc Agent. It does the same job as `app.py`, `app_pyqt5.py` and `app_tkinter.py`.

## Setup

Put this `web/` folder next to `doc_agent.py`. It reads the same `.env` from the folder above:

```
N8N_WEBHOOK_TOKEN=...
N8N_API_KEY=...
# Supabase (anonymous accounts, private history): run docs/supabase-app.sql and turn on anonymous sign-ins first
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...   # server only, never VITE_
# optional, defaults match doc_agent.py
# N8N_URL=http://localhost:5678
# N8N_WEBHOOK_PATH=/webhook/doc-agent
# N8N_WORKFLOW_ID=b6h5J6Rd4wfIh9Zs
```

```
cd web
npm install
npm run dev
```

Open http://localhost:5173/app/. n8n must be running on port 5678.

The landing page is at http://localhost:5173/. Its form opens the app with `?repo=<url>` filled in.

The Vite dev proxy adds the keys to each request, so the browser never sees them. This only works with `npm run dev`. A `npm run build` output has no proxy.

Live step progress needs the workflow's **Save execution progress** setting turned on in n8n.
