// Run: node tests/formula-raster.electron.cjs (no installs; isolated hidden Electron windows).
const {app,BrowserWindow,nativeImage}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
if(!app){
 const {spawnSync}=require('node:child_process');
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawnSync(require('electron'),[__filename],{stdio:'inherit',env});
 process.exit(child.status??1);
}
// Keep the harness alive between short-lived raster windows.
app.on('window-all-closed',()=>{});
const bundle=path.join(__dirname,`.formula-raster-${process.pid}.mjs`);
app.whenReady().then(async()=>{
 try{
  require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src/main/formulaRaster.ts')],outfile:bundle,bundle:true,platform:'node',format:'esm',external:['electron']});
  const {rasterizeFormula}=await import(pathToFileURL(bundle).href);
  const samples=['E=mc^2',String.raw`\frac{a+b}{c}=\int_0^1 x^2\,dx`,String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`,String.raw`\sum_{i=1}^{n}\alpha_i^2`];
  const verify=new BrowserWindow({show:false,webPreferences:{offscreen:true}});
  await verify.loadURL('data:text/html,<html></html>');
  try{
   for(const source of samples){
    const asset=await rasterizeFormula(source);
    assert.equal(asset.mimeType,'image/png');assert.match(asset.dataURL,/^data:image\/png;base64,/);
    const image=nativeImage.createFromDataURL(asset.dataURL);
    assert.ok(!image.isEmpty());
    const bytes=image.toBitmap();let ink=0;
    for(let i=0;i<bytes.length;i+=4) if(bytes[i+3]>0&&Math.min(bytes[i],bytes[i+1],bytes[i+2])<180) ink++;
    assert.ok(ink>30,`Blank formula: ${source}`);
    // The actual consumer path: PNG Image -> drawImage -> read pixels (not merely a screenshot).
    const canvas=await verify.webContents.executeJavaScript(`(async()=>{const i=new Image();i.src=${JSON.stringify(asset.dataURL)};await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);const p=ctx.getImageData(0,0,c.width,c.height).data;let ink=0;for(let j=0;j<p.length;j+=4)if(p[j+3]>0&&Math.min(p[j],p[j+1],p[j+2])<180)ink++;return {width:c.width,height:c.height,ink}})()`);
    assert.ok(canvas.ink>30);
    console.log(JSON.stringify({source,width:asset.width,height:asset.height,ink,canvas}));
   }
  }finally{verify.destroy();}
  const rendererBundle=bundle.replace('.mjs','-renderer.mjs');
  try{
   require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src/renderer/formula.ts')],outfile:rendererBundle,bundle:true,platform:'node',format:'esm'});
   const {formulaAsset,prepareDemoProject}=await import(pathToFileURL(rendererBundle).href);
   global.window={paperApi:{rasterizeFormula}};
   const asset=await formulaAsset('$$ E=mc^2 $$');
   assert.equal(asset.mimeType,'image/png');
   const original={canvases:{c:{elements:[{id:'formula',type:'image',x:10,y:20,width:100,height:50,fileId:'old',customData:{paperCanvas:{latex:'E=mc^2'}}}],files:{old:{id:'old',dataURL:'data:image/svg+xml;base64,obsolete'}}}}};
   const result=await prepareDemoProject(original);
   const element=result.canvases.c.elements[0];
   assert.equal(element.id,'formula');
   assert.equal(element.customData.paperCanvas.latex,'E=mc^2');
   assert.equal(result.canvases.c.files[element.fileId].mimeType,'image/png');
   assert.equal(original.canvases.c.elements[0].fileId,'old');
   assert.deepEqual(await prepareDemoProject(result),result);
   global.window={paperApi:{}};
   await assert.rejects(()=>formulaAsset('x'),/尚未连接/);
   console.log('PASS: renderer bridge, delimiter cleanup, legacy SVG repair, source metadata preservation, idempotent PNG migration');
  }finally{delete global.window;if(fs.existsSync(rendererBundle))fs.unlinkSync(rendererBundle);}
  await assert.rejects(()=>rasterizeFormula('\\notACommand'),/Undefined control sequence/);
  await assert.rejects(()=>rasterizeFormula(''),/源码/);
  await assert.rejects(()=>rasterizeFormula('x'.repeat(20001)),/源码/);
  console.log('PASS: real PNG, nonblank pixels, canvas draw/read, invalid input rejection');
 }finally{if(fs.existsSync(bundle))fs.unlinkSync(bundle);}
}).then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
