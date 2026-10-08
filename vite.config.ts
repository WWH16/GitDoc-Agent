import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

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
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      proxy: {
        '/api/generate': hook(webhookPath, 300_000),
        '/api/ask': hook(askPath, 120_000),
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
