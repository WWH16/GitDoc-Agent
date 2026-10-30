import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import { guardPlugin } from './server/guard.ts'

// Reads .env in this folder. No VITE_ prefix, so tokens stay in this dev proxy and never reach the browser.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const n8n = env.N8N_URL || 'http://localhost:5678'
  const webhookPath = env.N8N_WEBHOOK_PATH || '/webhook/doc-agent'
  const askPath = env.N8N_ASK_WEBHOOK_PATH || '/webhook/gitdoc-ask'
  const workflowId = env.N8N_WORKFLOW_ID || 'b6h5J6Rd4wfIh9Zs'
  // Webhook route: token header added here, long timeouts for slow LLM runs
  const hook = (path: string, ms: number) => ({
    target: n8n,
    changeOrigin: true,
    rewrite: () => path,
    headers: { 'X-Webhook-Token': env.N8N_WEBHOOK_TOKEN ?? '' },
    timeout: ms,
    proxyTimeout: ms,
  })

  return {
    // guardPlugin checks the session and rate limits before the proxy below forwards /api calls
    plugins: [
      react(),
      tailwindcss(),
      guardPlugin({ ...env, N8N_URL: n8n, N8N_WORKFLOW_ID: workflowId, N8N_WEBHOOK_PATH: webhookPath }),
    ],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    // Two pages: the landing page at / and the app at /app/
    build: {
      rolldownOptions: {
        input: {
          landing: fileURLToPath(new URL('./index.html', import.meta.url)),
          app: fileURLToPath(new URL('./app/index.html', import.meta.url)),
        },
      },
    },
    server: {
      // /api/generate and /api/progress are served by guardPlugin itself
      proxy: {
        // Ask can take 2+ minutes: each Gemini call on the free tier takes ~20 s and the agent makes several
        '/api/ask': hook(askPath, 300_000),
      },
    },
  }
})
