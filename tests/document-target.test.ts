import test from 'node:test'
import assert from 'node:assert/strict'
import { documentTargetFor } from '../src/main/document-target.ts'

test('an unsaved project has no destination', () => {
  assert.deepEqual(documentTargetFor(null, 'new-project'), { projectId: 'new-project', path: null })
})

test('ordinary saves and Save As defaults preserve the destination for the same identity', () => {
  const saved = { projectId: 'A', path: 'A.paper.json' }
  assert.deepEqual(documentTargetFor(saved, 'A'), saved)
})

test('a cancelled first save leaves the new identity without any old destination', () => {
  const next = documentTargetFor({ projectId: 'A', path: 'A.paper.json' }, 'B')
  assert.deepEqual(documentTargetFor(next, 'B'), { projectId: 'B', path: null })
})

test('after a successful save only the new identity can reuse its chosen destination', () => {
  const saved = { projectId: 'B', path: 'B.paper.json' }
  assert.deepEqual(documentTargetFor(saved, 'B'), saved)
  assert.deepEqual(documentTargetFor(saved, 'A'), { projectId: 'A', path: null })
})

test('opening A then saving a different new project discards A destination permanently', () => {
  const opened = { projectId: 'A', path: 'A.paper.json' }
  const next = documentTargetFor(opened, 'new-project')
  assert.deepEqual(next, { projectId: 'new-project', path: null })
  assert.deepEqual(documentTargetFor(next, 'A'), { projectId: 'A', path: null })
  assert.deepEqual(opened, { projectId: 'A', path: 'A.paper.json' })
})
