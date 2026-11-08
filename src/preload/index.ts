import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { PaperApi, Project } from '../shared/types.ts'

const api: PaperApi = {
  workspaceGet: () => ipcRenderer.invoke('paper:workspace:get'),
  workspaceChoose: () => ipcRenderer.invoke('paper:workspace:choose'),
  workspaceList: (relativePath = '') => ipcRenderer.invoke('paper:workspace:list', relativePath),
  workspaceRead: (relativePath) => ipcRenderer.invoke('paper:workspace:read', relativePath),
  workspaceReadDroppedFile: async (file) => {
    const path = webUtils.getPathForFile(file)
    if (!path) throw new Error('拖入文件没有本机路径，请直接读取 File 内容')
    return ipcRenderer.invoke('paper:workspace:read-dropped', path)
  },
  renderFormula: (source:string) => ipcRenderer.invoke('paper:formula-raster',source),
  open: () => ipcRenderer.invoke('paper:open'),
  save: (project: Project, saveAs = false) => ipcRenderer.invoke('paper:save', project, saveAs),
  onCommand(handler) {
    const listener = (_event: unknown, message: { id: string; command: unknown }) => {
      if (!message || typeof message.id !== 'string') return
      void Promise.resolve().then(() => handler(message.command)).then(
        (result) => ipcRenderer.send('paper:response', { id: message.id, result: result ?? null }),
        (error) => ipcRenderer.send('paper:response', { id: message.id, error: error instanceof Error ? error.message : 'Command failed' }),
      ).catch(() => { /* The window may have closed before the response was sent. */ })
    }
    ipcRenderer.on('paper:command', listener)
    return () => ipcRenderer.removeListener('paper:command', listener)
  },
}
contextBridge.exposeInMainWorld('paperApi', api)
