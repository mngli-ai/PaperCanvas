// Viewport geometry is injected so tests need no DOM or Excalidraw bundle.
export type HighlightRect = {left:number;top:number;width:number;height:number;borderColor:string};
export function executionHighlight(input:{loadedSceneRevision?:number;sceneRevision?:number;loadedCanvasId:string|null;canvasId:string;activeCanvasId:string|null;bounds:readonly number[]|null;state:any;origin:{left:number;top:number};color:string},toViewport:(point:{sceneX:number;sceneY:number},state:any)=>{x:number;y:number}):HighlightRect|null {
 const {loadedCanvasId,canvasId,activeCanvasId,bounds,state,origin,color}=input;
 if(input.sceneRevision!==input.loadedSceneRevision)return null;
 if(!loadedCanvasId||loadedCanvasId!==canvasId||activeCanvasId!==canvasId||!bounds)return null;
 const a=toViewport({sceneX:bounds[0],sceneY:bounds[1]},state),b=toViewport({sceneX:bounds[2],sceneY:bounds[3]},state);
 const rect={left:Math.min(a.x,b.x)-origin.left-6,top:Math.min(a.y,b.y)-origin.top-6,width:Math.abs(b.x-a.x)+12,height:Math.abs(b.y-a.y)+12,borderColor:color};
 return [rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)?rect:null;
}
export function sameHighlight(a:HighlightRect|null,b:HighlightRect|null){return a===b||!!a&&!!b&&a.left===b.left&&a.top===b.top&&a.width===b.width&&a.height===b.height&&a.borderColor===b.borderColor}
export type HierarchyMotion = {direction:'enter'|'return'|'switch';moduleId:string|null};
// Find the first visible module on an ancestry path, including multi-level returns.
export function hierarchyMotion(canvases:Record<string,{modules:Record<string,{childCanvasId:string}>}>,from:string,to:string):HierarchyMotion|null {
 if(from===to)return null;
 const firstModule=(root:string,target:string):string|null=>{
  const seen=new Set<string>();
  const reaches=(id:string):boolean=>{if(id===target)return true;if(seen.has(id))return false;seen.add(id);return Object.values(canvases[id]?.modules??{}).some(m=>reaches(m.childCanvasId))};
  return Object.entries(canvases[root]?.modules??{}).find(([,m])=>reaches(m.childCanvasId))?.[0]??null;
 };
 const entering=firstModule(from,to);if(entering)return {direction:'enter',moduleId:entering};
 const returning=firstModule(to,from);return returning?{direction:'return',moduleId:returning}:{direction:'switch',moduleId:null};
}
// Only fill absent defaults. Existing elements and explicit canvas preferences stay untouched.
export function drawingDefaults(state:Record<string,any>,excalifont:number){return {currentItemFontFamily:excalifont,currentItemRoughness:1,currentItemTextAlign:'center',...state}}
export function drawingPreferences(state:any){return Object.fromEntries(Object.entries(state).filter(([key])=>key.startsWith('currentItem')))}
