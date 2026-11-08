import {BrowserWindow} from 'electron';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import katex from 'katex';

export const FORMULA_RASTER_CHANNEL = 'paper:formula-raster';
export interface FormulaRaster {dataURL:string; width:number; height:number; mimeType:'image/png'}
let cssCache:string | undefined;
function katexCss():string {
 if(cssCache) return cssCache;
 const require=createRequire(import.meta.url);
 const cssPath=require.resolve('katex/dist/katex.min.css');
 cssCache=readFileSync(cssPath,'utf8').replace(/url\(([^)]+)\)/g,(all,raw:string)=>{
  const url=raw.trim().replace(/^['"]|['"]$/g,'');
  if(!url.startsWith('fonts/')) return all;
  const ext=url.split('.').pop();
  const mime=ext==='woff2'?'font/woff2':ext==='woff'?'font/woff':'font/ttf';
  return `url(data:${mime};base64,${readFileSync(resolve(dirname(cssPath),url)).toString('base64')})`;
 });
 return cssCache;
}

/** Main-process only. Call after app.whenReady(); expose via a narrow IPC handler. */
export async function rasterizeFormula(source:unknown):Promise<FormulaRaster> {
 if(typeof source!=='string'||!source.trim()||source.length>20000) throw new Error('公式源码为空或过长');
 // Parse before creating a window; trust:false prevents URLs, HTML and file access.
 const html=katex.renderToString(source,{displayMode:true,throwOnError:true,trust:false,output:'html',maxExpand:1000,maxSize:50});
 const win=new BrowserWindow({width:800,height:600,show:false,frame:false,backgroundColor:'#ffffff',
  webPreferences:{offscreen:true,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 let timer:ReturnType<typeof setTimeout> | undefined;
 try {
  return await Promise.race([
   (async()=>{
    const doc=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; script-src 'none'"><style>${katexCss()}
html,body{margin:0;padding:0;background:white;color:#172033}#formula{display:inline-block;padding:16px;font-size:24px;line-height:normal}#formula .katex-display{margin:0}</style></head><body><div id="formula">${html}</div></body></html>`;
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(doc));
    const size=await win.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;const r=document.getElementById('formula').getBoundingClientRect();return {width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);
    if(!Number.isFinite(size.width)||!Number.isFinite(size.height)||size.width<1||size.height<1||size.width>8192||size.height>8192||size.width*size.height>16000000) throw new Error('公式图片尺寸超出限制');
    win.setContentSize(size.width,size.height);
    await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const image=await win.webContents.capturePage({x:0,y:0,width:size.width,height:size.height});
    if(image.isEmpty()) throw new Error('公式截图为空');
    return {dataURL:image.toDataURL(),width:size.width,height:size.height,mimeType:'image/png' as const};
   })(),
   new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('公式渲染超时')),15000);}),
  ]);
 } finally {
  if(timer) clearTimeout(timer);
  if(!win.isDestroyed()) win.destroy();
 }
}
