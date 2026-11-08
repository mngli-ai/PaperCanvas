import { createServer } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

export const commandNames = ['inspect', 'read_canvas', 'apply_canvas', 'validate', 'runner_state'] as const
export interface BridgeOptions {
  dispatch: (command: Record<string, unknown>) => Promise<unknown>
  port?: number
  timeoutMs?: number
  maxBodyBytes?: number
}
class BridgeError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
export function isCommand(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const command = value as Record<string, unknown>
  if (!commandNames.includes(command.type as typeof commandNames[number])) return false
  if (command.type === 'read_canvas') return typeof command.canvasId === 'string' && command.canvasId.length > 0
  if (command.type === 'apply_canvas') return Number.isSafeInteger(command.expectedRevision) && (command.expectedRevision as number) >= 0 && !!command.canvas && typeof command.canvas === 'object' && !Array.isArray(command.canvas)
  return true
}

export function createCommandBroker(send: (message: { id: string; command: Record<string, unknown> }) => void, timeoutMs = 10_000) {
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  let disposed = false
  return {
    dispatch(command: Record<string, unknown>): Promise<unknown> {
      if (disposed) return Promise.reject(new BridgeError(503, 'Renderer unavailable'))
      if (pending.size >= 64) return Promise.reject(new BridgeError(503, 'Renderer busy'))
      return new Promise((resolve, reject) => {
        const id = randomUUID()
        const timer = setTimeout(() => { pending.delete(id); reject(new BridgeError(504, 'Renderer timed out')) }, timeoutMs)
        pending.set(id, { resolve, reject, timer })
        try { send({ id, command }) } catch {
          clearTimeout(timer); pending.delete(id); reject(new BridgeError(503, 'Renderer unavailable'))
        }
      })
    },
    respond(message: unknown) {
      if (!message || typeof message !== 'object') return
      const reply = message as { id?: string; result?: unknown; error?: unknown }
      if (typeof reply.id !== 'string') return
      const entry = pending.get(reply.id)
      if (!entry) return
      clearTimeout(entry.timer); pending.delete(reply.id)
      if (typeof reply.error === 'string') entry.reject(new BridgeError(422, reply.error.slice(0, 1000)))
      else entry.resolve(reply.result ?? null)
    },
    dispose() {
      disposed = true
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new BridgeError(503, 'Renderer unavailable')) }
      pending.clear()
    },
  }
}

export async function startBridge(options: BridgeOptions) {
  const host = '127.0.0.1'
  const token = randomBytes(32).toString('hex')
  const maxBodyBytes = options.maxBodyBytes ?? 8 * 1024 * 1024
  let active = 0
  const server = createServer(async (request, response) => {
    const send = (status: number, body: unknown) => {
      if (response.destroyed) return
      const text = JSON.stringify(body)
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      response.end(text)
    }
    const auth = Buffer.from(request.headers.authorization ?? '')
    const expected = Buffer.from(`Bearer ${token}`)
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) { send(401, { error: 'Unauthorized' }); request.resume(); return }
    if (request.headers.origin) { send(403, { error: 'Browser origins are not allowed' }); request.resume(); return }
    if (request.url !== '/command' || request.method !== 'POST') { send(404, { error: 'Not found' }); request.resume(); return }
    if (active >= 64) { send(503, { error: 'Bridge busy' }); request.resume(); return }
    active++
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (Number(request.headers['content-length'] ?? 0) > maxBodyBytes) { send(413, { error: 'Request too large' }); request.resume(); return }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += bytes.length
        if (size > maxBodyBytes) { send(413, { error: 'Request too large' }); request.resume(); return }
        chunks.push(bytes)
      }
      let command: unknown
      try { command = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new BridgeError(400, 'Invalid JSON') }
      if (!isCommand(command)) throw new BridgeError(400, 'Invalid command')
      const result = await Promise.race([
        Promise.resolve().then(() => options.dispatch(command)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BridgeError(504, 'Renderer timed out')), options.timeoutMs ?? 10_000) }),
      ])
      send(200, { result: result ?? null })
    } catch (error) {
      send(error instanceof BridgeError ? error.status : 503, { error: error instanceof BridgeError ? error.message : 'Renderer unavailable' })
    } finally { if (timer) clearTimeout(timer); active-- }
  })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 1_000
  server.maxHeadersCount = 32
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Bridge failed to bind')
  return { host, port: address.port, token, close: () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  }) }
}
