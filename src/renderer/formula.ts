import type {Project} from '../shared/types';
import katex from 'katex';

export interface FormulaAsset {dataURL:string; width:number; height:number; mimeType:'image/png'}
export function cleanLatex(value:string):string {
 const s=value.trim();
 if(s.startsWith('$$')&&s.endsWith('$$')) return s.slice(2,-2).trim();
 if(s.startsWith('$')&&s.endsWith('$')) return s.slice(1,-1).trim();
 if(s.startsWith('\\[')&&s.endsWith('\\]')) return s.slice(2,-2).trim();
 return s;
}
export function renderFormula(value:string):string {
 return katex.renderToString(cleanLatex(value),{displayMode:true,throwOnError:true,trust:false,output:'html',maxExpand:1000,maxSize:50});
}
export async function prepareDemoProject(project:Project):Promise<Project>{
 const result=structuredClone(project);
 for(const canvas of Object.values(result.canvases)){
  for(let i=0;i<canvas.elements.length;i++){
   const e=canvas.elements[i] as any;
   const latex=e.customData?.paperCanvas?.latex;
   if(!latex) continue;
   // Repair legacy foreignObject SVG assets too, not only the demo placeholders.
   const oldFile=(e.fileId?canvas.files[e.fileId]:undefined) as {dataURL?:string}|undefined;
   if(e.type==='image'&&oldFile?.dataURL?.startsWith('data:image/png')) continue;
   const asset=await formulaAsset(latex);
   const fileId=crypto.randomUUID();
   canvas.files[fileId]={id:fileId,dataURL:asset.dataURL,mimeType:asset.mimeType,created:Date.now()};
   canvas.elements[i]={...e,type:'image',x:e.x+e.width/2-asset.width/2,width:asset.width,height:asset.height,fileId,scale:[1,1],status:'saved',crop:null,containerId:null,version:(e.version??1)+1};
  }
 }
 return result;
}
export async function formulaAsset(latex:string):Promise<FormulaAsset>{
 const source=cleanLatex(latex);
 if(!source||source.length>20000) throw new Error('公式源码为空或过长');
 renderFormula(source); // Preserve immediate syntax feedback and the existing source-edit loop.
 const api=(window as unknown as {paperApi?:{renderFormula?:(source:string)=>Promise<FormulaAsset>}}).paperApi;
 if(!api?.renderFormula) throw new Error('公式 PNG 渲染服务尚未连接，请重启更新后的桌面应用');
 const asset=await api.renderFormula(source);
 if(asset.mimeType!=='image/png'||!asset.dataURL?.startsWith('data:image/png;base64,')||!Number.isFinite(asset.width)||!Number.isFinite(asset.height)||asset.width<=0||asset.height<=0) throw new Error('公式渲染服务返回了无效图片');
 return asset;
}
