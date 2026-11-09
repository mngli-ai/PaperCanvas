import { mkdir, lstat, open, opendir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path'
import type { WorkspaceEntry, WorkspaceFile, WorkspaceFileKind, WorkspaceInfo, WorkspaceListing, WorkspaceOpenResult } from '../shared/types.ts'
import { parseProject } from '../domain/project.ts'

export const WORKSPACE_FILE_LIMIT = 32 * 1024 * 1024
export const WORKSPACE_ENTRY_LIMIT = 1000
const SCAN_LIMIT = 10000

export function workspaceFileKind(name: string): WorkspaceFileKind | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.excalidrawlib')) return 'excalidrawlib'
  if (lower.endsWith('.excalidraw')) return 'excalidraw'
  if (lower.endsWith('.json')) return 'json'
  return null
}

function validateName(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 255 || value === '.' || value === '..'
    || /[<>:"/\\\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value)
    || /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(value)) throw new Error('无效目录或文件名')
  return value
}

function validateRelative(value: unknown, allowRoot = false): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\\\0:]/.test(value) || isAbsolute(value) || win32.isAbsolute(value)) throw new Error('无效工作区相对路径')
  if (allowRoot && value === '') return value
  if (!value || value.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('无效工作区相对路径')
  value.split('/').forEach(validateName)
  return value
}

function confined(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

export class WorkspaceStore {
  private root: string | null = null
  private preferencePath: string
  private loaded = false
  constructor(preferencePath: string) { this.preferencePath = preferencePath }

  private info(): WorkspaceInfo {
    if (!this.root) throw new Error('请先选择工作区文件夹')
    return { rootPath: this.root, name: basename(this.root) || this.root }
  }

  async get(): Promise<WorkspaceInfo | null> {
    if (!this.loaded) {
      this.loaded = true
      try {
        if ((await stat(this.preferencePath)).size > 16384) return null
        const saved: unknown = JSON.parse(await readFile(this.preferencePath, 'utf8'))
        const root = (saved as { rootPath?: unknown })?.rootPath
        if (typeof root === 'string' && isAbsolute(root)) {
          const canonical = await realpath(root)
          if ((await stat(canonical)).isDirectory()) this.root = canonical
        }
      } catch { /* Missing, stale or corrupt local preference is not fatal. */ }
    }
    if (!this.root) return null
    try {
      if ((await realpath(this.root)) !== this.root || !(await stat(this.root)).isDirectory()) return null
      return this.info()
    } catch { return null }
  }

  async choose(path: string): Promise<WorkspaceInfo> {
    const root = await realpath(path)
    if (!(await stat(root)).isDirectory()) throw new Error('工作区必须是目录')
    await mkdir(dirname(this.preferencePath), { recursive: true })
    const temporary = `${this.preferencePath}.${process.pid}.tmp`
    try {
      await writeFile(temporary, JSON.stringify({ rootPath: root }), { mode: 0o600 })
      await rename(temporary, this.preferencePath)
    } finally { await unlink(temporary).catch(() => {}) }
    this.root = root
    this.loaded = true
    return this.info()
  }

  private async target(value: unknown, allowRoot = false): Promise<{ root: string; path: string; relativePath: string }> {
    const relativePath = validateRelative(value, allowRoot)
    const info = await this.get()
    if (!info) throw new Error('工作区不存在，请重新选择文件夹')
    const root = info.rootPath
    const path = await realpath(resolve(root, relativePath))
    if (!confined(root, path)) throw new Error('文件超出已授权工作区')
    let component = root
    for (const part of relativePath ? relativePath.split('/') : []) {
      component = resolve(component, part)
      if ((await lstat(component)).isSymbolicLink()) throw new Error('不允许通过符号链接或 junction 访问工作区')
    }
    return { root, path, relativePath }
  }

  async createFolder(parentValue: unknown, nameValue: unknown): Promise<WorkspaceEntry> {
    const name = validateName(nameValue)
    const parent = await this.target(parentValue, true)
    if (!(await stat(parent.path)).isDirectory()) throw new Error('父路径必须是目录')
    const relativePath = [parent.relativePath, name].filter(Boolean).join('/')
    validateRelative(relativePath)
    // recursive:false is exclusive: existing files, directories and links all fail.
    await mkdir(resolve(parent.path, name), { recursive: false })
    return { name, relativePath, type: 'directory' }
  }

  async open(value: unknown): Promise<WorkspaceOpenResult> {
    const file = await this.read(value)
    if (file.kind === 'excalidrawlib') throw new Error('素材库不能作为工程打开，请使用素材导入')
    if (file.kind === 'excalidraw') return { ...file, type: 'excalidraw', project: null, path: null }
    const project = parseProject(file.text)
    return { ...file, type: 'project', project, path: resolve(file.workspace.rootPath, file.relativePath) }
  }

  async list(value: unknown = ''): Promise<WorkspaceListing> {
    const target = await this.target(value, true)
    const entries: WorkspaceListing['entries'] = []
    let truncated = false
    let scanned = 0
    const directory = await opendir(target.path)
    for await (const entry of directory) {
      if (++scanned > SCAN_LIMIT) { truncated = true; break }
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const kind = workspaceFileKind(entry.name)
      if (!entry.isDirectory() && !(entry.isFile() && kind)) continue
      if (entries.length >= WORKSPACE_ENTRY_LIMIT) { truncated = true; break }
      const relativePath = [target.relativePath, entry.name].filter(Boolean).join('/')
      // Only paths accepted by the reader are exposed (including Unix filenames).
      try { validateRelative(relativePath) } catch { continue }
      entries.push(entry.isDirectory() ? { name: entry.name, relativePath, type: 'directory' } : { name: entry.name, relativePath, type: 'file', kind: kind! })
    }
    entries.sort((a, b) => (a.type === b.type ? 0 : a.type === 'directory' ? -1 : 1) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
    return { workspace: { rootPath: target.root, name: basename(target.root) || target.root }, relativePath: target.relativePath, entries, truncated }
  }

  async read(value: unknown): Promise<WorkspaceFile> {
    const target = await this.target(value)
    const name = target.relativePath.split('/').at(-1)!
    const kind = workspaceFileKind(name)
    if (!kind) throw new Error('不支持的工作区文件格式')
    const handle = await open(target.path, 'r')
    try {
      const details = await handle.stat()
      if (!details.isFile()) throw new Error('只能读取普通文件')
      if (details.size > WORKSPACE_FILE_LIMIT) throw new Error('文件超过 32 MiB 限制')
      // Bounded read also rejects a file growing after stat; no unbounded readFile.
      const buffer = Buffer.alloc(Math.min(details.size + 1, WORKSPACE_FILE_LIMIT + 1))
      let length = 0
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null)
        if (!bytesRead) break
        length += bytesRead
      }
      if (length > details.size) throw new Error('文件读取期间发生变化，请重试')
      return { workspace: { rootPath: target.root, name: basename(target.root) || target.root }, name, relativePath: target.relativePath, kind, text: buffer.subarray(0, length).toString('utf8') }
    } finally { await handle.close() }
  }

  async readDroppedPath(value: unknown): Promise<WorkspaceFile> {
    if (typeof value !== 'string' || value.length > 4096 || !isAbsolute(value) || value.includes('\0')) throw new Error('无效拖入文件')
    const info = await this.get()
    if (!info) throw new Error('请先选择工作区文件夹，或直接读取拖入 File 的内容')
    // Reject outside paths before probing their filesystem metadata.
    if (!confined(info.rootPath, value)) throw new Error('拖入文件不在已授权工作区内')
    return this.read(relative(info.rootPath, value).split(sep).join('/'))
  }
}
