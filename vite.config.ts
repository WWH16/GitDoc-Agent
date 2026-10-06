import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

// Reads the same .env as doc_agent.py (one folder up). Keys stay in this dev proxy and never reach the browser.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const n8n = env.N8N_URL || 'http://localhost:5678'
  const webhookPath = env.N8N_WEBHOOK_PATH || '/webhook-test/doc-agent' // /webhook/doc-agent after activating
  const workflowId = env.N8N_WORKFLOW_ID || 'b6h5J6Rd4wfIh9Zs'

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      proxy: {
        '/api/generate': {
          target: n8n,
          changeOrigin: true,
          rewrite: () => webhookPath,
          headers: { 'X-Webhook-Token': env.N8N_WEBHOOK_TOKEN ?? '' },
          timeout: 300_000,
          proxyTimeout: 300_000,
        },
        '/api/executions': {
          target: n8n,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/executions\??/, `/api/v1/executions?workflowId=${workflowId}&`),
          headers: { 'X-N8N-API-KEY': env.N8N_API_KEY ?? '' },
        },
      },
    },
  }
})
