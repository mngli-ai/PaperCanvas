#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const configPath = process.env.PAPER_CANVAS_BRIDGE_CONFIG || join(
  process.env.APPDATA || (process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME || join(homedir(), '.config')),
  'paper-canvas', 'bridge.json',
)
const empty = { type: 'object', properties: {}, additionalProperties: false }
const tools = [
  { name: 'inspect', description: 'Inspect the open PaperCanvas project, canvases and revision.', inputSchema: empty },
  { name: 'read_canvas', description: 'Read one canvas including elements, modules and explicit routes.', inputSchema: { type: 'object', properties: { canvasId: { type: 'string', minLength: 1 } }, required: ['canvasId'], additionalProperties: false } },
  { name: 'apply_canvas', description: 'Replace a canvas at an expected project revision. Read first; stale revisions are rejected. This cannot execute code or access files.', inputSchema: { type: 'object', properties: { expectedRevision: { type: 'integer', minimum: 0 }, canvas: { type: 'object', description: 'Complete Canvas: id,title,elements,files,appState,modules,routes.' } }, required: ['expectedRevision', 'canvas'], additionalProperties: false } },
  { name: 'validate', description: 'Validate the currently open project.', inputSchema: empty },
  { name: 'runner_state', description: 'Read explicit presentation runner state; does not execute neural networks.', inputSchema: empty },
]
const server = new Server({ name: 'paper-canvas', version: '0.1.0' }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const tool = tools.find((item) => item.name === params.name)
    if (!tool) throw new Error('Unknown PaperCanvas tool')
    const args = params.arguments ?? {}
    if (Object.keys(args).some((key) => !Object.hasOwn(tool.inputSchema.properties, key))) throw new Error('Unexpected tool argument')
    if (params.name === 'read_canvas' && (typeof args.canvasId !== 'string' || !args.canvasId)) throw new Error('canvasId is required')
    if (params.name === 'apply_canvas' && (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0 || !args.canvas || typeof args.canvas !== 'object' || Array.isArray(args.canvas))) throw new Error('A nonnegative expectedRevision and complete canvas are required')
    // Re-read per call so a desktop restart/rotated token needs no MCP client restart.
    const config = JSON.parse(await readFile(configPath, 'utf8'))
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535 || typeof config.token !== 'string' || !/^[a-f0-9]{64}$/.test(config.token)) throw new Error('Invalid PaperCanvas bridge config')
    const response = await fetch(`http://127.0.0.1:${config.port}/command`, {
      method: 'POST', headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: params.name, ...args }), signal: AbortSignal.timeout(12_000),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || `Bridge HTTP ${response.status}`)
    return { content: [{ type: 'text', text: JSON.stringify(body.result, null, 2) }] }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bridge request failed'
    console.error(`[paper-canvas MCP] ${message}`)
    return { isError: true, content: [{ type: 'text', text: message }] }
  }
})
await server.connect(new StdioServerTransport())
