export interface ModuleLink { elementId: string; childCanvasId: string; title: string; latex?: string; source?: string }
export interface Step { id: string; elementId: string; label: string; childCanvasId?: string; childRouteId?: string }
export interface Route { id: string; name: string; color: string; steps: Step[] }
export interface Canvas { id: string; title: string; elements: unknown[]; files: Record<string, unknown>; appState: Record<string, unknown>; modules: Record<string, ModuleLink>; routes: Route[] }
export interface Project { schemaVersion: 1; id: string; title: string; rootCanvasId: string; revision: number; canvases: Record<string, Canvas> }
export interface PaperApi { renderFormula(source:string):Promise<{dataURL:string;width:number;height:number;mimeType:'image/png'}>; open(): Promise<{path:string;project:Project}|null>; save(project:Project,saveAs?:boolean):Promise<string|null>; onCommand(handler:(command:any)=>Promise<any>):()=>void }
