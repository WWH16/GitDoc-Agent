import assert from 'node:assert/strict'
import { test } from 'node:test'
import config from '../vite.config.ts'

// `vite preview` copies server.proxy by default, which would forward /api/ask with the n8n token and no guard
test('vite preview has no unguarded n8n proxy', async () => {
  const c = typeof config === 'function' ? await config({ command: 'serve', mode: 'test', isPreview: true }) : config
  assert.deepEqual(c.preview?.proxy, {})
})
