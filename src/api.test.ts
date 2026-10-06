import assert from 'node:assert/strict'
import { test } from 'node:test'
import { currentStep, showProgressHint, timeline } from './api.ts'

test('orders nodes by first start time', () => {
  const t = timeline({ B: [{ startTime: 20, executionTime: 5 }], A: [{ startTime: 10, executionTime: 3 }] }, null)
  assert.deepEqual(t.map((n) => n.name), ['A', 'B'])
  assert.deepEqual(t.map((n) => n.status), ['done', 'done'])
})

test('loop node becomes one row with run count and summed time', () => {
  const t = timeline({ Loop: [{ startTime: 1, executionTime: 4 }, { startTime: 9, executionTime: 3 }] }, null)
  assert.deepEqual(t, [{ name: 'Loop', status: 'done', runs: 2, ms: 7 }])
})

test('running node not yet in runData is appended as running', () => {
  const t = timeline({ A: [{ startTime: 1, executionTime: 2 }] }, 'Get File Contents')
  assert.deepEqual(t.at(-1), { name: 'Get File Contents', status: 'running', runs: 0, ms: 0 })
})

test('running node already in runData (next loop pass) is marked running, not duplicated', () => {
  const t = timeline({ Loop: [{ startTime: 1, executionTime: 4 }] }, 'Loop')
  assert.equal(t.length, 1)
  assert.equal(t[0].status, 'running')
})

test('node with an error is marked error', () => {
  const t = timeline({ Agent: [{ startTime: 1, executionTime: 2, error: { message: 'quota' } }] }, null)
  assert.equal(t[0].status, 'error')
})

test('empty runData and no running node gives an empty list', () => {
  assert.deepEqual(timeline({}, null), [])
})

test('progress hint shows only after 10 s with no finished nodes', () => {
  const running = [{ name: 'Webhook', status: 'running' as const, runs: 0, ms: 0 }]
  assert.equal(showProgressHint(5, []), false)
  assert.equal(showProgressHint(12, []), true)
  assert.equal(showProgressHint(12, running), true)
  assert.equal(showProgressHint(12, [{ name: 'Webhook', status: 'done', runs: 1, ms: 1 }]), false)
})

test('currentStep still maps finished nodes to coarse steps', () => {
  assert.equal(currentStep(new Set()), 0)
  assert.equal(currentStep(new Set(['Valid GitHub URL?', 'Group Files'])), 2)
})
