export interface ModuleLink { elementId: string; childCanvasId: string; title: string; latex?: string; source?: string }
export interface Step { id: string; elementId: string; label: string; childCanvasId?: string; childRouteId?: string }
export interface Route { id: string; name: string; color: string; steps: Step[] }
export interface Canvas { id: string; title: string; elements: unknown[]; files: Record<string, unknown>; appState: Record<string, unknown>; modules: Record<string, ModuleLink>; routes: Route[] }
export interface Project { schemaVersion: 1; id: string; title: string; rootCanvasId: string; revision: number; canvases: Record<string, Canvas> }
export type WorkspaceFileKind = 'json' | 'excalidraw' | 'excalidrawlib'
export interface WorkspaceInfo { rootPath: string; name: string }
export interface WorkspaceEntry { name: string; relativePath: string; type: 'directory' | 'file'; kind?: WorkspaceFileKind }
export interface WorkspaceListing { workspace: WorkspaceInfo; relativePath: string; entries: WorkspaceEntry[]; truncated: boolean }
export interface WorkspaceFile { workspace: WorkspaceInfo; name: string; relativePath: string; kind: WorkspaceFileKind; text: string }
export type WorkspaceOpenResult = WorkspaceFile & (
  | { type: 'project'; project: Project; path: string }
  | { type: 'excalidraw'; project: null; path: null }
)
export interface PaperApi {
  workspaceCreateFolder(parentRelativePath: string, name: string): Promise<WorkspaceEntry>
  workspaceOpen(relativePath: string): Promise<WorkspaceOpenResult>
  workspaceGet(): Promise<WorkspaceInfo | null>
  workspaceChoose(): Promise<WorkspaceInfo | null>
  workspaceList(relativePath?: string): Promise<WorkspaceListing>
  workspaceRead(relativePath: string): Promise<WorkspaceFile>
  workspaceReadDroppedFile(file: File): Promise<WorkspaceFile>
  renderFormula(source:string):Promise<{dataURL:string;width:number;height:number;mimeType:'image/png'}>; open(): Promise<{path:string;project:Project}|null>; save(project:Project,saveAs?:boolean):Promise<string|null>; onCommand(handler:(command:any)=>Promise<any>):()=>void }
