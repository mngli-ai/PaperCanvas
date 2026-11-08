# PaperCanvas initial contract

Independent Electron + React + Excalidraw desktop research editor. All workers inherit gpt-6.1-sol @ momo2; no lwl dispatch. Do not alter Hermes config. Code lives outside OneDrive. Domain and runner use pure TypeScript, tests run node --experimental-strip-types --test tests/*.test.ts. Relative TS imports include .ts. No installs or git commits by workers.

## Ownership
- Main: package.json, configs, src/shared/types.ts, src/renderer/**, docs/**, integration.
- Domain worker: src/domain/** and tests/domain.test.ts only.
- Runner worker: src/runner/** and tests/runner.test.ts only.
- Desktop/MCP worker: src/main/**, src/preload/**, scripts/mcp-server.mjs, tests/bridge.test.ts only. No config/package changes; report dependencies to main.

## Frozen shared types
Located src/shared/types.ts. Excalidraw elements stored as unknown[] (renderer casts at boundary). Canvas {id,title,elements,files,appState,modules,routes}; modules maps element ID to {elementId,childCanvasId,title,latex?,source?}; Route {id,name,color,steps:Step[]}; Step {id,elementId,label,childCanvasId?,childRouteId?}; Project {schemaVersion:1,id,title,rootCanvasId,revision,canvases:Record<string,Canvas>}; steps represent explicit presentation routes, NOT automatic execution inferred from arrows.

## Domain API src/domain/project.ts
createProject(): Project (empty root 'root'); createDemoProject(): Project (DiT hierarchy demo, root forward calling dit forward, dit calls attention forward); addChildCanvas(project,parentCanvasId,elementId,title): Project; updateCanvas(project,canvas:Canvas):Project; validateProject(project):string[]; parseProject(text):Project (throws invalid); serializeProject(project):string. Pure nonmutating functions, revision increments on edits. createDemoProject may use simple Excalidraw element JSON compatible with renderer restoreElements. All module targets must exist; cycles in child canvas references rejected. Build tests first, show failing then passing.

## Runner API src/runner/runner.ts
RunnerState {status:'idle'|'paused'|'running'|'completed',stack:Frame[],history:Snapshot[]}; Frame {canvasId,routeId,index:number}; Snapshot excludes history = {status,stack}. exports createRunner(project,canvasId,routeId):RunnerState (paused at first step, empty route completed), stepInto(project,state), stepOver(project,state), stepOut(project,state), stepBack(state), currentStep(project,state): {canvasId,step:Step}|null. Enter child route only when explicit child route exists. Into enters child first step; over skips entire current child and advances sibling; out leaves current frame and advances parent. End child auto returns parent advanced. End root completed. History supports rewind; no edits to project. Guard recursive calls to prevent infinite stack. Default continuous UI calls stepInto on interval. Explicit branches/loops deferred.

## Desktop interface
window.paperApi optional in browser fallback. preload exposes open():Promise<{path:string,project:Project}|null>, save(project:Project,saveAs?:boolean):Promise<string|null>, onCommand(handler:(command:any)=>Promise<any>):()=>void. main process native file dialogs, disk read/write JSON, renderer-independent localhost bridge. contextIsolation true, nodeIntegration false, no remote content navigation.

Bridge listen only 127.0.0.1 ephemeral port (or PAPER_CANVAS_BRIDGE_PORT), random token persisted in app userData bridge.json (port,token), authorization Bearer. Every /command request forwarded to renderer and response correlated; timeout; request limit. Renderer supports inspect, read_canvas, apply_canvas (revision checked), validate, runner_state. Reject writes if revision mismatched. Expose MCP stdio adapter scripts/mcp-server.mjs using @modelcontextprotocol/sdk when available; user selects tools in client manually; logs stderr only. Must not expose arbitrary JS eval/filesystem.

## Limits
Do not pretend to run neural networks or fabricate paper facts. Demo explicitly labeled illustrative. Actual UI screenshot/testing owned by main. Report precise files and commands executed.
