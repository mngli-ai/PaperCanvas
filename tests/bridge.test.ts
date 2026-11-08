import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startBridge, createCommandBroker } from '../src/main/bridge.ts'

test('invalid, oversized, unknown and cross-origin requests never dispatch', async () => {
  let count = 0
  const bridge = await startBridge({ maxBodyBytes: 80, dispatch: async () => { count++; return null } })
  const post = (body: string, extra = {}) => fetch(`http://127.0.0.1:${bridge.port}/command`, { method: 'POST', headers: { authorization: `Bearer ${bridge.token}`, ...extra }, body })
  try {
    assert.equal((await post('{')).status, 400)
    assert.equal((await post('null')).status, 400)
    assert.equal((await post('{"type":"eval"}')).status, 400)
    assert.equal((await post(' '.repeat(81))).status, 413)
    assert.equal((await post('{"type":"inspect"}', { origin: 'https://evil.example' })).status, 403)
    assert.equal((await post('{"type":"apply_canvas","canvas":{}}')).status, 400)
    assert.equal(count, 0)
  } finally { await bridge.close() }
})

test('write command carries expectedRevision and canvas without permitting arbitrary tools', async () => {
  let received: unknown
  const bridge = await startBridge({ dispatch: async (command) => { received = command; return { revision: 8 } } })
  try {
    const command = { type: 'apply_canvas', expectedRevision: 7, canvas: { id: 'root' } }
    const response = await fetch(`http://127.0.0.1:${bridge.port}/command`, { method: 'POST', headers: { authorization: `Bearer ${bridge.token}` }, body: JSON.stringify(command) })
    assert.equal(response.status, 200)
    assert.deepEqual(received, command)
    assert.deepEqual(await response.json(), { result: { revision: 8 } })
  } finally { await bridge.close() }
})

test('renderer timeout returns 504; rejected dispatch returns 503', async () => {
  for (const [dispatch, status] of [[() => new Promise(() => {}), 504], [async () => { throw new Error('secret stack') }, 503]] as const) {
    const bridge = await startBridge({ timeoutMs: 20, dispatch })
    try {
      const response = await fetch(`http://127.0.0.1:${bridge.port}/command`, { method: 'POST', headers: { authorization: `Bearer ${bridge.token}` }, body: '{"type":"inspect"}' })
      assert.equal(response.status, status)
      assert.doesNotMatch(await response.text(), /secret stack/)
    } finally { await bridge.close() }
  }
})

test('broker correlates out-of-order replies, rejects timeout and disposal', async () => {
  const sent: { id: string; command: Record<string, unknown> }[] = []
  const broker = createCommandBroker((message) => sent.push(message), 25)
  const first = broker.dispatch({ type: 'inspect' })
  const second = broker.dispatch({ type: 'validate' })
  assert.notEqual(sent[0].id, sent[1].id)
  broker.respond({ id: sent[1].id, result: 'second' })
  broker.respond({ id: sent[0].id, result: 'first' })
  assert.equal(await first, 'first')
  assert.equal(await second, 'second')
  await assert.rejects(broker.dispatch({ type: 'inspect' }), /timed out/)
  const pending = broker.dispatch({ type: 'inspect' })
  broker.dispose()
  await assert.rejects(pending, /unavailable/)
  await assert.rejects(broker.dispatch({ type: 'inspect' }), /unavailable/)
})

test('bridge binds IPv4 loopback and authenticates before dispatch', async () => {
  const { startBridge } = await import('../src/main/bridge.ts')
  const received: unknown[] = []
  const bridge = await startBridge({ dispatch: async (command) => { received.push(command); return { title: 'PaperCanvas' } } })
  try {
    assert.equal(bridge.host, '127.0.0.1')
    assert.match(bridge.token, /^[a-f0-9]{64}$/)
    const url = `http://127.0.0.1:${bridge.port}/command`
    assert.equal((await fetch(url, { method: 'POST', body: '{"type":"inspect"}' })).status, 401)
    assert.equal(received.length, 0)
    const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' }, body: '{"type":"inspect"}' })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { result: { title: 'PaperCanvas' } })
    assert.deepEqual(received, [{ type: 'inspect' }])
  } finally { await bridge.close() }
})
