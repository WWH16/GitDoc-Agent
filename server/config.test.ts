import assert from 'node:assert/strict'
import { test } from 'node:test'
import config from '../vite.config.ts'

// `vite preview` serves the app on Render. Its /api/ask proxy adds the n8n token, so the guard must run there too.
test('vite preview proxies /api/ask only behind the guard', async () => {
  const c = typeof config === 'function' ? await config({ command: 'serve', mode: 'test', isPreview: true }) : config
  assert.ok(c.preview?.proxy?.['/api/ask'])
  const guard = c.plugins?.flat().find((p) => p && typeof p === 'object' && 'name' in p && p.name === 'gitdoc-api-guard')
  assert.ok(guard && 'configurePreviewServer' in guard && guard.configurePreviewServer)
})
