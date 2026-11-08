# 工作区后端 API（右侧文件 / 素材浏览器）

通过 `window.paperApi` 调用，所有方法异步，取消目录选择返回 `null`，操作失败 reject。已有 open/save/renderFormula/onCommand 不变。

- `workspaceGet(): Promise<WorkspaceInfo | null>`：恢复本机 userData/workspace.json 的目录；失效目录返回 null。
- `workspaceChoose(): Promise<WorkspaceInfo | null>`：主进程系统目录选择器，成功后持久化；取消不改变旧目录。
- `workspaceList(relativePath = ''): Promise<WorkspaceListing>`：惰性列举一层；返回 `{ workspace, relativePath, entries, truncated }`。entries 是 `{ name, relativePath, type: 'directory' | 'file', kind?: 'json' | 'excalidraw' | 'excalidrawlib' }`；目录优先排序。每层最多 1000 条；不跟随符号链接；隐藏目录和 node_modules 不显示。目录可能无支持文件，前端可延迟展开。
- `workspaceRead(relativePath): Promise<WorkspaceFile>`：返回 `{ workspace, name, relativePath, kind, text }`；原始 UTF-8 文本由 renderer 校验 / 导入，不修改当前项目保存路径。
- `workspaceReadDroppedFile(file: File): Promise<WorkspaceFile>`：preload 使用 Electron webUtils 提取真实路径，仅允许当前已选工作区中的支持文件，调用主进程窄读取接口。没有本机路径 / 工作区外的文件拒绝。外部 OS 文件如需导入，请 renderer 显式使用用户拖入的 `File.text()`（先检查大小 / 后缀），不要加入任意路径读取 IPC。

`WorkspaceInfo = { rootPath: string; name: string }`。`relativePath` 使用 `/`，根目录是空字符串；所有路径必须相对已选目录，禁止绝对路径、反斜杠、空段、`.` / `..`、Windows ADS 和 NUL。后缀允许 `.json`（包括 `.papercanvas.json`）、`.excalidraw`、`.excalidrawlib`，不区分大小写。读取上限 32 MiB，必须为普通文件，realpath 必须仍处于根目录内；符号链接越界拒绝。

拖动树节点到画布时，建议 MIME `application/x-papercanvas-workspace-file`，内容为 `{ relativePath }`；drop 后调用 workspaceRead，再根据 kind / JSON 内容进入项目模块导入或 Excalidraw 素材导入。目录本身不读取。工作区切换只更新浏览范围，不移动文件，不更改现有项目 / 保存目标。renderer 不应把 rootPath 拼接为自行读取路径。

IPC：`paper:workspace:get` / `choose` / `list` / `read` / `read-dropped`，全部采用现有 trusted 主窗口与主 frame 校验。无通用 readFile / 任意绝对路径读盘接口。目录读取权限属于用户显式选择的根目录；本地其他进程恶意并发替换目录的 TOCTOU 不属于该 renderer IPC 边界保证。
