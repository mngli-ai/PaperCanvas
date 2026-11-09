import React, { useEffect, useRef, useState } from 'react';
import type { WorkspaceFile, WorkspaceInfo } from '../shared/types.ts';

export interface BrowserEntry { name: string; relativePath: string; type: 'directory' | 'file' }
type BrowserApi = NonNullable<Window['paperApi']> & {
  workspaceOpen?: (path: string) => Promise<WorkspaceFile>;
  workspaceCreateFolder?: (parent: string, name: string) => Promise<unknown>;
};
const parentPath = (path: string) => path.split('/').slice(0, -1).join('/');

function TreeIcon({ folder, open = false }: { folder: boolean; open?: boolean }) {
  return <svg className="tree-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    {folder ? <path d={open ? 'M2 7V4h6l2 2h7v2M2 8h17l-3 9H3L2 8Z' : 'M2 5h6l2 2h8v10H2V5Z'} /> : <><path d="M5 2h6l4 4v12H5V2Z" /><path d="M11 2v5h4M7 11h6M7 14h6" /></>}
  </svg>;
}

export function WorkspaceBrowser({ onOpen, onImport, onLibrary, onError }: {
  onOpen: (text: string) => void;
  onImport: (text: string, title: string) => void;
  onLibrary: (text: string) => void;
  onError: (message: string) => void;
}) {
  const api = window.paperApi as BrowserApi | undefined;
  const [root, setRoot] = useState<WorkspaceInfo | null>(null);
  const [entries, setEntries] = useState<Record<string, BrowserEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<BrowserEntry | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newFolder, setNewFolder] = useState<{ parent: string; name: string } | null>(null);
  const working = useRef(false);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  const report = (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    setError(message);
    onError(message);
  };
  const run = async (label: string, action: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(label);
    setError('');
    try { await action(); } catch (reason) { report(reason); }
    finally { working.current = false; setBusy(''); }
  };
  const requireApi = () => {
    if (!api) throw new Error('文件浏览器需要桌面版工作区接口，请在 PaperCanvas 桌面应用中使用。');
    return api;
  };
  const list = async (path = '') => {
    const result = await requireApi().workspaceList(path);
    setEntries(old => ({ ...old, [path]: result.entries }));
    if (result.truncated) setNotice('目录内容较多，仅显示部分条目。');
    return result.entries;
  };

  useEffect(() => {
    void run('正在加载工作区…', async () => {
      if (!api) return;
      const current = await api.workspaceGet();
      if (current) { setRoot(current); await list(); }
    });
  }, []);

  const choose = () => run('正在打开文件夹…', async () => {
    const current = await requireApi().workspaceChoose();
    if (!current) return;
    setRoot(current);
    setEntries({});
    setExpanded({});
    setSelected(null);
    setNewFolder(null);
    setNotice('');
    await list();
  });
  const read = (entry: BrowserEntry, asModule = false) => run(asModule ? '正在导入模块…' : '正在打开文件…', async () => {
    const client = requireApi();
    // Opening may update the backend's active document; importing must remain read-only.
    const isLibrary = entry.name.toLowerCase().endsWith('.excalidrawlib');
    const file = !asModule && !isLibrary && client.workspaceOpen
      ? await client.workspaceOpen(entry.relativePath)
      : await client.workspaceRead(entry.relativePath);
    if (file.kind === 'excalidrawlib') onLibrary(file.text);
    else if (asModule) onImport(file.text, entry.name);
    else onOpen(file.text);
  });
  const toggle = (entry: BrowserEntry, open = !expanded[entry.relativePath]) => run('正在加载目录…', async () => {
    if (open && !entries[entry.relativePath]) await list(entry.relativePath);
    setExpanded(old => ({ ...old, [entry.relativePath]: open }));
  });
  const refresh = () => run('正在刷新文件树…', async () => {
    setNotice('');
    const paths = ['', ...Object.keys(expanded).filter(path => expanded[path])];
    const next: Record<string, BrowserEntry[]> = {};
    // Replace the cache only once all visible directories have been read successfully.
    for (const path of paths) {
      const result = await requireApi().workspaceList(path);
      next[path] = result.entries;
      if (result.truncated) setNotice('目录内容较多，仅显示部分条目。');
    }
    setEntries(next);
    if (selected && !Object.values(next).some(items => items.some(item => item.relativePath === selected.relativePath))) setSelected(null);
  });
  const startFolder = () => {
    setError('');
    const parent = selected ? selected.type === 'directory' ? selected.relativePath : parentPath(selected.relativePath) : '';
    setNewFolder({ parent, name: '' });
  };
  const createFolder = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newFolder) return;
    const { parent } = newFolder;
    const name = newFolder.name.trim();
    if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name)) {
      report(new Error('请输入有效文件夹名，不要包含路径分隔符、特殊字符或末尾句点。'));
      return;
    }
    void run('正在新建文件夹…', async () => {
      const client = requireApi();
      if (!client.workspaceCreateFolder) throw new Error('当前桌面接口不支持新建文件夹，请更新或重启 PaperCanvas。');
      await client.workspaceCreateFolder(parent, name);
      // Close the input after creation, even if the subsequent refresh fails (avoid duplicate creation).
      setNewFolder(null);
      await list(parent);
      setExpanded(old => ({ ...old, ...(parent ? { [parent]: true } : {}) }));
      setSelected({ name, relativePath: [parent, name].filter(Boolean).join('/'), type: 'directory' });
    });
  };

  const visible: BrowserEntry[] = [];
  const collect = (path: string) => {
    for (const entry of entries[path] ?? []) {
      visible.push(entry);
      if (entry.type === 'directory' && expanded[entry.relativePath]) collect(entry.relativePath);
    }
  };
  collect('');
  const focusEntry = (entry?: BrowserEntry) => {
    if (!entry) return;
    setSelected(entry);
    rowRefs.current.get(entry.relativePath)?.focus();
  };
  const navigate = (event: React.KeyboardEvent, entry: BrowserEntry) => {
    const index = visible.findIndex(item => item.relativePath === entry.relativePath);
    if (event.key === 'ArrowDown') focusEntry(visible[Math.min(index + 1, visible.length - 1)]);
    else if (event.key === 'ArrowUp') focusEntry(visible[Math.max(0, index - 1)]);
    else if (event.key === 'Home') focusEntry(visible[0]);
    else if (event.key === 'End') focusEntry(visible.at(-1));
    else if (event.key === 'ArrowRight' && entry.type === 'directory') {
      if (!expanded[entry.relativePath]) void toggle(entry, true);
      else if (entries[entry.relativePath]?.length) focusEntry(entries[entry.relativePath][0]);
    } else if (event.key === 'ArrowLeft') {
      if (entry.type === 'directory' && expanded[entry.relativePath]) void toggle(entry, false);
      else focusEntry(visible.find(item => item.relativePath === parentPath(entry.relativePath)));
    } else return; // Native buttons provide Enter / Space activation.
    event.preventDefault();
  };

  const tree = (path: string, depth = 0): React.ReactNode => (entries[path] ?? []).map(entry => {
    const folder = entry.type === 'directory';
    const active = selected?.relativePath === entry.relativePath;
    return <div key={entry.relativePath} role="none">
      <div className={`file-row${active ? ' is-selected' : ''}`} role="none">
        <button ref={node => { if (node) rowRefs.current.set(entry.relativePath, node); else rowRefs.current.delete(entry.relativePath); }}
          className={`file-entry${folder ? ' folder' : ''}`} style={{ '--tree-depth': depth } as React.CSSProperties}
          role="treeitem" aria-level={depth + 1} aria-selected={active} aria-expanded={folder ? !!expanded[entry.relativePath] : undefined}
          tabIndex={active || (!selected && visible[0] === entry) ? 0 : -1} disabled={!!busy}
          title={folder ? entry.relativePath : `${entry.relativePath} — 单击打开；拖到画布导入为模块`}
          draggable={!folder && !busy}
          onDragStart={event => { setSelected(entry); event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-papercanvas-workspace', JSON.stringify({ path: entry.relativePath, name: entry.name })); }}
          onFocus={() => setSelected(entry)} onKeyDown={event => navigate(event, entry)}
          onClick={() => { setSelected(entry); if (folder) void toggle(entry); else void read(entry); }}>
          <span className={`tree-chevron${folder && expanded[entry.relativePath] ? ' is-expanded' : ''}`} aria-hidden="true">{folder ? '›' : ''}</span>
          <TreeIcon folder={folder} open={!!expanded[entry.relativePath]} /><span className="tree-name">{entry.name}</span>
        </button>
        {!folder && <button className="file-import" title={`将 ${entry.name} 导入为模块`} aria-label={`将 ${entry.name} 导入为模块`} disabled={!!busy} onClick={() => { setSelected(entry); void read(entry, true); }}>＋</button>}
      </div>
      {folder && expanded[entry.relativePath] && <div role="group">{tree(entry.relativePath, depth + 1)}{entries[entry.relativePath]?.length === 0 && <p className="tree-empty" style={{ '--tree-depth': depth + 1 } as React.CSSProperties}>空文件夹</p>}</div>}
    </div>;
  });

  return <section className="workspace-browser" aria-label="文件浏览器" aria-busy={!!busy}>
    <div className="pane-heading"><h3>文件浏览器</h3><button disabled={!!busy} onClick={() => void choose()}>打开文件夹</button></div>
    <div className="browser-actions"><button disabled={!root || !!busy} onClick={startFolder}>＋ 新建文件夹</button><button disabled={!root || !!busy} title="刷新文件树" aria-label="刷新文件树" onClick={() => void refresh()}>↻</button></div>
    {error && <p className="browser-error" role="alert">{error}</p>}
    <div className="browser-status" role="status" aria-live="polite">{busy || notice}</div>
    {newFolder && <form className="folder-create" onSubmit={createFolder}>
      <label htmlFor="workspace-folder-name">新建到：{newFolder.parent || root?.name || '根目录'}</label>
      <input id="workspace-folder-name" autoFocus value={newFolder.name} disabled={!!busy} placeholder="文件夹名称" aria-label="新文件夹名称" onChange={event => setNewFolder({ ...newFolder, name: event.target.value })} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); setNewFolder(null); } }} />
      <div className="folder-create-actions"><button type="submit" disabled={!!busy || !newFolder.name.trim()}>创建</button><button type="button" disabled={!!busy} onClick={() => setNewFolder(null)}>取消</button></div>
    </form>}
    {root ? <><button className={`workspace-root${!selected ? ' is-selected' : ''}`} title={`${root.rootPath} — 点击选择根目录`} disabled={!!busy} onClick={() => setSelected(null)}>{root.name}</button>
      <div className="workspace-tree" role="tree" aria-label="工作区文件">{tree('')}</div>
      {entries['']?.length === 0 && <p className="empty-hint">文件夹为空，或没有支持的文件。可先新建文件夹。</p>}
    </> : <p className="empty-hint">选择工程文件夹。单击文件打开，拖到画布导入为可展开模块。</p>}
  </section>;
}
