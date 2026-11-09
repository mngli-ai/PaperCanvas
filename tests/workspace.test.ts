import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceStore, WORKSPACE_ENTRY_LIMIT, WORKSPACE_FILE_LIMIT } from '../src/main/workspace.ts'
import { createProject } from '../src/domain/project.ts'
import { documentTargetFor } from '../src/main/document-target.ts'

async function fixture(t: any) {
  const base = await mkdtemp(join(tmpdir(), 'paper-workspace-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const root = join(base, 'root')
  await mkdir(root)
  const preference = join(base, 'prefs', 'workspace.json')
  const store = new WorkspaceStore(preference)
  await store.choose(root)
  return { base, root, preference, store }
}

test('workspace persists local root and lazily lists supported project/material files', async (t) => {
  const { root, store, preference } = await fixture(t)
  await mkdir(join(root, '目录'))
  await mkdir(join(root, '.git'))
  await mkdir(join(root, 'node_modules'))
  for (const name of ['a.papercanvas.json', 'b.excalidraw', 'c.EXCALIDRAWLIB', 'legacy.json', 'ignore.png']) await writeFile(join(root, name), '{}')
  await writeFile(join(root, '目录', 'deep.json'), '{"hello":"世界"}')
  const restored = new WorkspaceStore(preference)
  assert.deepEqual(await restored.get(), await store.get())
  const listing = await restored.list()
  assert.equal(listing.truncated, false)
  assert.equal(listing.entries[0].type, 'directory')
  assert.equal(listing.entries.length, 5)
  assert.ok(!listing.entries.some((entry) => entry.relativePath.includes('deep')))
  assert.equal((await restored.list('目录')).entries[0].relativePath, '目录/deep.json')
  assert.equal((await restored.read('目录/deep.json')).text, '{"hello":"世界"}')
  assert.equal((await restored.read('c.EXCALIDRAWLIB')).kind, 'excalidrawlib')
  assert.equal((await restored.readDroppedPath(join(root, 'b.excalidraw'))).kind, 'excalidraw')
})

test('workspace rejects traversal, absolute, ADS, malformed input and unsupported file reads', async (t) => {
  const { root, base, store } = await fixture(t)
  await writeFile(join(root, 'ignore.txt'), 'private')
  await writeFile(join(base, 'secret.json'), 'secret')
  for (const path of ['', '..', '../secret.json', '/secret.json', 'C:/secret.json', 'a\\b.json', 'a//b.json', './a.json', 'a.json:stream', 'x\0.json', 5, null, {}]) {
    await assert.rejects(store.read(path))
  }
  await assert.rejects(store.list('../'))
  await assert.rejects(store.read('ignore.txt'), /不支持/)
  await assert.rejects(store.readDroppedPath(join(base, 'secret.json')), /不在/)
  await assert.rejects(store.readDroppedPath('relative.json'), /无效/)
})

test('workspace realpath rejects symlink/junction escape, including directory traversal', async (t) => {
  const { root, base, store } = await fixture(t)
  const outside = join(base, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'secret.json'), 'secret')
  // Directory junctions do not require Windows developer-mode symlink privileges.
  await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(store.read('escape/secret.json'), /超出/)
  await assert.rejects(store.list('escape'), /超出/)
  await assert.rejects(store.readDroppedPath(join(root, 'escape', 'secret.json')), /超出/)
  assert.ok(!(await store.list()).entries.some((entry) => entry.name === 'escape'))
})

test('workspace bounds listing and file reads and rejects directories', async (t) => {
  const { root, store } = await fixture(t)
  await mkdir(join(root, 'folder.json'))
  await assert.rejects(store.read('folder.json'), /普通文件/)
  const handle = await open(join(root, 'large.json'), 'w')
  await handle.truncate(WORKSPACE_FILE_LIMIT + 1)
  await handle.close()
  await assert.rejects(store.read('large.json'), /32 MiB/)
  await Promise.all(Array.from({ length: WORKSPACE_ENTRY_LIMIT + 1 }, (_, i) => writeFile(join(root, `${i}.json`), '{}')))
  const listing = await store.list()
  assert.equal(listing.entries.length, WORKSPACE_ENTRY_LIMIT)
  assert.equal(listing.truncated, true)
})

test('workspace missing/corrupt preferences do not grant a root', async (t) => {
  const { base, preference } = await fixture(t)
  await writeFile(preference, '{broken')
  const store = new WorkspaceStore(preference)
  assert.equal(await store.get(), null)
  await assert.rejects(store.read('x.json'), /工作区不存在/)
  await writeFile(preference, JSON.stringify({ rootPath: join(base, 'missing') }))
  assert.equal(await new WorkspaceStore(preference).get(), null)
})

test('workspace creates one exclusive directory under an existing parent', async (t) => {
  const { root, store } = await fixture(t)
  assert.deepEqual(await store.createFolder('', '新目录'), { name: '新目录', relativePath: '新目录', type: 'directory' })
  assert.equal((await store.createFolder('新目录', '子目录')).relativePath, '新目录/子目录')
  await assert.rejects(store.createFolder('', '新目录'), /EEXIST/)
  await writeFile(join(root, 'occupied'), 'keep')
  await assert.rejects(store.createFolder('', 'occupied'), /EEXIST/)
  await assert.rejects(store.createFolder('missing', 'child'))
  for (const name of ['', '.', '..', '../escape', 'a/b', 'a\\b', 'C:ads', 'CON', 'con.json', 'LPT1', 'COM9.txt', 'NUL', 'AUX', 'PRN', 'COM¹', 'bad.', 'bad ', 'bad?', 'bad\0', 'bad\n', null, 5]) {
    await assert.rejects(store.createFolder('', name), String(name))
  }
  await assert.rejects(store.createFolder('../', 'escape'))
})

test('workspace open validates projects and distinguishes unbound Excalidraw imports', async (t) => {
  const { root, store } = await fixture(t)
  const project = createProject()
  await writeFile(join(root, 'project.json'), JSON.stringify(project))
  const result = await store.open('project.json')
  assert.equal(result.type, 'project')
  assert.deepEqual(result.project, project)
  assert.equal(result.path, join((await store.get())!.rootPath, 'project.json'))
  const target = result.type === 'project' ? { projectId: result.project.id, path: result.path } : null
  assert.equal(documentTargetFor(target, project.id).path, result.path)
  assert.equal(documentTargetFor(target, 'different').path, null)
  await writeFile(join(root, 'bad.json'), '{}')
  await assert.rejects(store.open('bad.json'))
  await writeFile(join(root, 'broken.json'), '{bad')
  await assert.rejects(store.open('broken.json'))
  await writeFile(join(root, 'scene.excalidraw'), '{"type":"excalidraw"}')
  const imported = await store.open('scene.excalidraw')
  assert.equal(imported.type, 'excalidraw')
  assert.equal(imported.path, null)
  assert.equal(imported.project, null)
  assert.equal(imported.text, '{"type":"excalidraw"}')
  await writeFile(join(root, 'library.excalidrawlib'), '{}')
  await assert.rejects(store.open('library.excalidrawlib'), /素材库/)
})

test('workspace rejects even in-root junction aliases for read, open and creation', async (t) => {
  const { root, store } = await fixture(t)
  await mkdir(join(root, 'real'))
  await writeFile(join(root, 'real', 'project.json'), JSON.stringify(createProject()))
  await symlink(join(root, 'real'), join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(store.createFolder('alias', 'child'), /符号链接/)
  await assert.rejects(store.read('alias/project.json'), /符号链接/)
  await assert.rejects(store.open('alias/project.json'), /符号链接/)
  await assert.rejects(store.list('alias'), /符号链接/)
})
