import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { IpcMainInvokeEvent, IpcMainEvent } from 'electron'
import { readFile, writeFile, mkdir, rename, unlink, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseProject, serializeProject } from '../domain/project.ts'
import type { Project } from '../shared/types.ts'
import { createCommandBroker, startBridge } from './bridge.ts'
import {FORMULA_RASTER_CHANNEL,rasterizeFormula} from './formulaRaster';
import { documentTargetFor } from './document-target.ts'
import type { DocumentTarget } from './document-target.ts'

if(process.env.PAPER_CANVAS_TEST_PROFILE) app.setPath('userData',process.env.PAPER_CANVAS_TEST_PROFILE)
let window: BrowserWindow | null = null
let currentTarget: DocumentTarget | null = null
let broker: ReturnType<typeof createCommandBroker> | null = null
let bridge: Awaited<ReturnType<typeof startBridge>> | null = null
let configPath = ''
let quitting = false
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const mainDirectory = dirname(fileURLToPath(import.meta.url))
const rendererFile = join(mainDirectory, '../renderer/index.html')

function trusted(event: IpcMainInvokeEvent | IpcMainEvent) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender')
  const url = new URL(event.senderFrame.url)
  if (devUrl ? url.origin !== new URL(devUrl).origin : url.protocol !== 'file:' || fileURLToPath(url) !== rendererFile) throw new Error('Untrusted IPC location')
}

async function createWindow() {
  currentTarget = null
  const win = new BrowserWindow({
    width: 1440, height: 960, minWidth: 960, minHeight: 640, title: 'PaperCanvas',
    webPreferences: { preload: join(mainDirectory, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  })
  window = win
  broker = createCommandBroker((message) => {
    if (win.isDestroyed() || win.webContents.isLoadingMainFrame()) throw new Error('Renderer unavailable')
    win.webContents.send('paper:command', message)
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  win.webContents.session.setPermissionCheckHandler(() => false)
  win.webContents.on('render-process-gone', () => broker?.dispose())
  win.on('closed', () => { broker?.dispose(); broker = null; window = null })
  if (devUrl) await win.loadURL(devUrl)
  else await win.loadFile(rendererFile)
}

let renderingFormula=false;
ipcMain.handle(FORMULA_RASTER_CHANNEL,async(event,source:unknown)=>{trusted(event);if(renderingFormula)throw Error('公式正在渲染，请稍后');renderingFormula=true;try{return await rasterizeFormula(source)}finally{renderingFormula=false}});
ipcMain.handle('paper:open', async (event) => {
  trusted(event)
  const result = await dialog.showOpenDialog(window!, { title: 'Open PaperCanvas project', properties: ['openFile'], filters: [{ name: 'PaperCanvas JSON', extensions: ['json'] }] })
  if (result.canceled || !result.filePaths[0]) return null
  const path = result.filePaths[0]
  if ((await stat(path)).size > 32 * 1024 * 1024) throw new Error('Project exceeds 32 MiB limit')
  const project = parseProject(await readFile(path, 'utf8'))
  currentTarget = { projectId: project.id, path }
  return { path, project }
})
ipcMain.handle('paper:save', async (event, project: Project, saveAs = false) => {
  trusted(event)
  const validatedProject = parseProject(JSON.stringify(project))
  const text = serializeProject(validatedProject)
  if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error('Project exceeds 32 MiB limit')
  // New/example projects are created in the renderer without an open IPC.
  // Forget a previous document's destination before showing any save dialog.
  currentTarget = documentTargetFor(currentTarget, validatedProject.id)
  let path = currentTarget.path
  if (!path || saveAs) {
    const result = await dialog.showSaveDialog(window!, { title: 'Save PaperCanvas project', defaultPath: path ?? 'project.paper.json', filters: [{ name: 'PaperCanvas JSON', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return null
    path = result.filePath
  }
  const temporary = `${path}.${process.pid}.tmp`
  try { await writeFile(temporary, text, 'utf8'); await rename(temporary, path) }
  finally { await unlink(temporary).catch(() => {}) }
  currentTarget = { projectId: validatedProject.id, path }
  return path
})
ipcMain.on('paper:response', (event, message: unknown) => {
  try { trusted(event); broker?.respond(message) } catch { /* Ignore untrusted replies. */ }
})

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus() })
  app.whenReady().then(async () => {
    const requestedPort = process.env.PAPER_CANVAS_BRIDGE_PORT
    const port = requestedPort === undefined ? 0 : Number(requestedPort)
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PAPER_CANVAS_BRIDGE_PORT')
    await createWindow()
    bridge = await startBridge({ port, dispatch: (command) => broker ? broker.dispatch(command) : Promise.reject(new Error('Renderer unavailable')) })
    configPath = join(app.getPath('userData'), 'bridge.json')
    await mkdir(app.getPath('userData'), { recursive: true })
    const temporary = `${configPath}.tmp`
    await writeFile(temporary, JSON.stringify({ port: bridge.port, token: bridge.token }), { mode: 0o600 })
    await rename(temporary, configPath)
    app.on('activate', () => { if (!window) void createWindow().catch((error) => console.error(error)) })
  }).catch((error) => { console.error('PaperCanvas startup failed:', error); app.quit() })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault(); quitting = true
    broker?.dispose()
    void Promise.all([bridge?.close(), configPath ? unlink(configPath).catch(() => {}) : Promise.resolve()]).finally(() => app.quit())
  })
}
