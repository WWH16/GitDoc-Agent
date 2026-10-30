import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workflowDrawings } from './lib/markdown.ts'

test("workflowDrawings maps the workflow's diagram images by number and skips anything else", () => {
  const preview = [
    '![Diagram 1](data:image/svg+xml;base64,PHN2Zz4=)',
    '```mermaid\ngraph TD\n```\n\n_Diagram could not be rendered, showing its source instead._',
    '![Diagram 3](https://mermaid.ink/svg/eyJjb2RlIjoiZ3JhcGgifQ)',
    '![Diagram 4](javascript:alert(1))',
    '![Logo](data:image/svg+xml;base64,AAAA)',
  ].join('\n\n')
  assert.deepEqual(
    [...workflowDrawings(preview)],
    [
      [1, 'data:image/svg+xml;base64,PHN2Zz4='],
      [3, 'https://mermaid.ink/svg/eyJjb2RlIjoiZ3JhcGgifQ'],
    ],
  )
})
