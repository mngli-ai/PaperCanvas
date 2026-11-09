#!/usr/bin/env node
// Portable architecture-subset validator. No PaperCanvas or npm dependency.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LIMITS = Object.freeze({ nodeWidth:420, labelSize:20, labelLines:8, detailWidth:360, detailSize:16, detailLines:10, titleWidth:900, titleSize:28, titleLines:3 });
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' && v.trim().length > 0;
const finite = Number.isFinite;
const near = (a,b) => Math.abs(a-b)<0.1;
export function textWidth(value, size) {
  return [...value].reduce((w,c) => w + size * (/\s/u.test(c) ? .42 : /[MW@%&#]/u.test(c) ? 1.1 : c.codePointAt(0)>0xffff ? 1.5 : c.codePointAt(0)>255 ? 1.15 : .8), 0);
}
export function wrapText(value, size, width, maxLines) {
  if (typeof value === 'string') value=value.replace(/\r\n/g,'\n');
  if (!text(value) || /[\u0000-\u0009\u000b-\u001f\u007f]/u.test(value)) throw new Error('Text must be nonempty and contain no control characters (except newline)');
  const lines=[];
  for (const paragraph of value.replace(/\r\n/g,'\n').split('\n')) {
    let line='';
    for (const ch of paragraph) {
      if (textWidth(line+ch,size)>width && line) {lines.push(line.trimEnd());line='';}
      line+=ch;
    }
    lines.push(line.trimEnd());
  }
  if (lines.length>maxLines) throw new Error(`Text exceeds supported ${maxLines} wrapped lines; split into child modules`);
  return { text:lines.join('\n'), width:Math.max(1,...lines.map(l=>textWidth(l,size))), height:lines.length*size*1.35 };
}
// Iterative Kahn traversal: no fixed nesting depth and no recursive stack limit.
export function acyclic(ids, edges) {
  const degree=new Map(ids.map(id=>[id,0])), next=new Map(ids.map(id=>[id,[]]));
  for(const [a,b] of edges) { if(!degree.has(a)||!degree.has(b)) return false; next.get(a).push(b);degree.set(b,degree.get(b)+1); }
  const queue=ids.filter(id=>degree.get(id)===0);
  for(let i=0;i<queue.length;i++) for(const b of next.get(queue[i])) {degree.set(b,degree.get(b)-1);if(degree.get(b)===0)queue.push(b);}
  return queue.length===ids.length;
}
const overlaps = (a,b) => a.x < b.x+b.width-.1 && a.x+a.width > b.x+.1 && a.y < b.y+b.height-.1 && a.y+a.height > b.y+.1;
function segmentHits(a,b,r) {
  // Open interior, so a line may touch a box boundary but never cut through it.
  let lo=0,hi=1; const eps=.2;
  for(const [start,delta,min,max] of [[a[0],b[0]-a[0],r.x+eps,r.x+r.width-eps],[a[1],b[1]-a[1],r.y+eps,r.y+r.height-eps]]) {
    if(Math.abs(delta)<1e-8) {if(start<=min||start>=max)return false;}
    else {const t1=(min-start)/delta,t2=(max-start)/delta;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));if(lo>=hi)return false;}
  }
  return lo<hi;
}
function distanceToBox(p,r) {return Math.hypot(Math.max(r.x-p[0],0,p[0]-r.x-r.width),Math.max(r.y-p[1],0,p[1]-r.y-r.height));}

export function validate(project) {
  const errors=[],stats={canvases:0,nodes:0,arrows:0,routes:0,maxDepth:0};
  const fail=m=>{if(errors.length<300)errors.push(m);};
  const seen=new Set();
  const unique=(id,where)=>{if(!text(id))fail(`${where}: missing ID`);else if(seen.has(id))fail(`${where}: global ID collision ${id}`);else seen.add(id);};
  if(!obj(project)) return {valid:false,errors:['Project must be an object'],stats};
  if(project.schemaVersion!==1)fail('Unsupported schemaVersion');
  unique(project.id,'Project');if(!text(project.title))fail('Missing project title');
  if(!Number.isSafeInteger(project.revision)||project.revision<0)fail('Invalid revision');
  if(!obj(project.canvases))return {valid:false,errors:[...errors,'canvases must be an object'],stats};
  const canvases=project.canvases,ids=Object.keys(canvases),children=[],parents=new Map(ids.map(id=>[id,0]));
  if(!Object.hasOwn(canvases,project.rootCanvasId))fail('Missing root canvas');
  stats.canvases=ids.length;
  for(const [cid,c] of Object.entries(canvases)) {
    const at=`Canvas ${cid}`;unique(cid,at);
    if(!obj(c)){fail(`${at}: must be an object`);continue;}
    if(c.id!==cid)fail(`${at}: id mismatch`);if(!text(c.title))fail(`${at}: missing title`);
    if(!obj(c.files)||Object.keys(c.files).length)fail(`${at}: files must be an empty object for this subset`);
    if(!obj(c.appState)||c.appState.currentItemFontFamily!==5||c.appState.currentItemRoughness!==1)fail(`${at}: unsupported appState style`);
    if(!Array.isArray(c.elements)){fail(`${at}: elements must be array`);continue;}
    const elements=c.elements.filter(obj),map=new Map(),nodes=[],texts=[],arrows=[];
    if(elements.length!==c.elements.length)fail(`${at}: malformed element`);
    for(const e of elements) {
      unique(e.id,at);map.set(e.id,e);
      if(!['rectangle','text','arrow'].includes(e.type))fail(`${at}/${e.id}: unsupported element type`);
      if(e.isDeleted!==false)fail(`${at}/${e.id}: deleted/invalid element`);
      for(const k of ['x','y','width','height']) if(!finite(e[k])||(['width','height'].includes(k)&&e[k]<0)||Math.abs(e[k])>1e7)fail(`${at}/${e.id}: invalid geometry ${k}`);
      if(e.roughness!==1||e.angle!==0||e.opacity!==100)fail(`${at}/${e.id}: unsupported style/rotation`);
      if(e.boundElements!==null&&!Array.isArray(e.boundElements))fail(`${at}/${e.id}: invalid boundElements`);
      if(Array.isArray(e.boundElements)) {const refs=new Set();for(const b of e.boundElements) {if(!obj(b)||!text(b.id)||refs.has(b.id))fail(`${at}/${e.id}: malformed/duplicate binding`);else refs.add(b.id);}}
      if(e.type==='rectangle')nodes.push(e);if(e.type==='text')texts.push(e);if(e.type==='arrow')arrows.push(e);
    }
    stats.nodes+=nodes.length;stats.arrows+=arrows.length;
    if(!nodes.length)fail(`${at}: empty canvas (no module nodes)`);
    for(const n of nodes) {
      if(!near(n.width,LIMITS.nodeWidth)||n.height<76||n.height>280)fail(`${at}/${n.id}: unsupported node size`);
      const labels=texts.filter(t=>t.containerId===n.id),refs=Array.isArray(n.boundElements)?n.boundElements:[];
      if(labels.length!==1||!refs.some(b=>obj(b)&&b.type==='text'&&b.id===labels[0]?.id))fail(`${at}/${n.id}: missing reciprocal label binding`);
      for(const b of refs) {
        const target=map.get(b?.id);
        if(b?.type==='text'&&target?.type==='text'&&target.containerId===n.id)continue;
        if(b?.type==='arrow'&&target?.type==='arrow'&&(target.startBinding?.elementId===n.id||target.endBinding?.elementId===n.id))continue;
        fail(`${at}/${n.id}: stale reciprocal binding`);
      }
    }
    for(const t of texts) {
      const container=t.containerId===null?null:map.get(t.containerId);
      if(t.fontFamily!==5||t.textAlign!=='center'||t.lineHeight!==1.35||t.autoResize!==true||typeof t.originalText!=='string')fail(`${at}/${t.id}: unsupported text style`);
      const role=container?'label':t.fontSize===LIMITS.titleSize?'title':'detail';
      const size=role==='label'?20:role==='title'?28:16,maxWidth=role==='label'?380:role==='title'?900:360,maxLines=role==='label'?8:role==='title'?3:10;
      if(t.fontSize!==size||!text(t.text)||/[\u0000-\u0009\u000b-\u001f\u007f]/u.test(t.text??'')){fail(`${at}/${t.id}: invalid text`);continue;}
      const lines=t.text.split('\n'),required=Math.max(...lines.map(l=>textWidth(l,t.fontSize)));
      if(lines.length>maxLines||required>maxWidth+.1||t.width+0.1<required||t.width>maxWidth+.1||!near(t.height,lines.length*size*1.35))fail(`${at}/${t.id}: clipped/oversize label or long wrap`);
      try{if(wrapText(t.originalText,size,maxWidth,maxLines).text!==t.text)fail(`${at}/${t.id}: text does not match originalText wrapping`);}catch{fail(`${at}/${t.id}: invalid originalText`);}
      if(t.containerId!==null) {
        if(container?.type!=='rectangle')fail(`${at}/${t.id}: missing label container`);
        else if(t.verticalAlign!=='middle'||!near(t.x+t.width/2,container.x+container.width/2)||!near(t.y+t.height/2,container.y+container.height/2)||t.x<container.x+19||t.x+t.width>container.x+container.width-19||t.y<container.y+19||t.y+t.height>container.y+container.height-19)fail(`${at}/${t.id}: label not centered/contained`);
      } else if(t.verticalAlign!=='top')fail(`${at}/${t.id}: free text vertical alignment`);
      if(t.boundElements!==null)fail(`${at}/${t.id}: text must not own bindings`);
    }
    const solids=[...nodes,...texts.filter(t=>t.containerId===null)];
    for(let i=0;i<solids.length;i++)for(let j=i+1;j<solids.length;j++)if(overlaps(solids[i],solids[j]))fail(`${at}: geometry collision ${solids[i].id} / ${solids[j].id}`);
    const pairs=new Set();
    for(const a of arrows) {
      const start=map.get(a.startBinding?.elementId),end=map.get(a.endBinding?.elementId);
      if(start?.type!=='rectangle'||end?.type!=='rectangle'||start===end){fail(`${at}/${a.id}: missing/invalid arrow endpoint binding`);continue;}
      const pair=JSON.stringify([start.id,end.id]);if(pairs.has(pair))fail(`${at}: duplicate edge`);pairs.add(pair);
      for(const [b,node] of [[a.startBinding,start],[a.endBinding,end]])if(!finite(b.gap)||b.gap<0||b.gap>24||b.focus!==0||!node.boundElements?.some(r=>r?.id===a.id&&r.type==='arrow'))fail(`${at}/${a.id}: missing reciprocal arrow binding or invalid gap`);
      if(a.startArrowhead!==null||a.endArrowhead!=='arrow'||a.elbowed!==false||a.boundElements!==null)fail(`${at}/${a.id}: unsupported arrow style`);
      if(!Array.isArray(a.points)||a.points.length<2||a.points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(finite))){fail(`${at}/${a.id}: invalid points`);continue;}
      const points=a.points.map(p=>[a.x+p[0],a.y+p[1]]);
      if(!near(a.points[0][0],0)||!near(a.points[0][1],0)||!near(Math.max(...a.points.map(p=>p[0]))-Math.min(...a.points.map(p=>p[0])),a.width)||!near(Math.max(...a.points.map(p=>p[1]))-Math.min(...a.points.map(p=>p[1])),a.height))fail(`${at}/${a.id}: arrow point dimensions mismatch`);
      if(!near(distanceToBox(points[0],start),a.startBinding.gap)||!near(distanceToBox(points.at(-1),end),a.endBinding.gap))fail(`${at}/${a.id}: arrow endpoints detached from bound boxes`);
      for(let i=1;i<points.length;i++)for(const r of solids)if(segmentHits(points[i-1],points[i],r))fail(`${at}/${a.id}: connector crosses ${r.id}`);
    }
    // Data-flow feedback cycles are valid; only the child-canvas hierarchy must be acyclic.
    if(!obj(c.modules))fail(`${at}: modules must be object`);
    const modules=obj(c.modules)?c.modules:{};
    for(const [key,m] of Object.entries(modules)) {
      if(!obj(m)){fail(`${at}: invalid module`);continue;}
      if(m.elementId!==key||map.get(key)?.type!=='rectangle'||!text(m.title))fail(`${at}: missing/mismatched module node`);
      if(!Object.hasOwn(canvases,m.childCanvasId))fail(`${at}: missing child canvas`);
      else {children.push([cid,m.childCanvasId]);parents.set(m.childCanvasId,parents.get(m.childCanvasId)+1);}
    }
    if(!Array.isArray(c.routes)||!c.routes.length)fail(`${at}: explicit nonempty routes required`);
    for(const route of Array.isArray(c.routes)?c.routes:[]) {
      if(!obj(route)){fail(`${at}: invalid route`);continue;}
      stats.routes++;unique(route.id,`${at} route`);
      if(!text(route.name)||!text(route.color)||!Array.isArray(route.steps)||!route.steps.length){fail(`${at}: invalid/empty route`);continue;}
      const visited=new Set();
      for(const s of route.steps) {
        if(!obj(s)){fail(`${at}: invalid route step`);continue;}
        unique(s.id,`${at} step`);
        if(map.get(s.elementId)?.type!=='rectangle'||visited.has(s.elementId)||!text(s.label))fail(`${at}: missing/repeated route node`);visited.add(s.elementId);
        const m=modules[s.elementId];
        if(m) {
          const child=canvases[m.childCanvasId];
          if(s.childCanvasId!==m.childCanvasId||!text(s.childRouteId)||!Array.isArray(child?.routes)||!child.routes.some(r=>r?.id===s.childRouteId))fail(`${at}: module route missing/mismatched child call`);
        }else if(s.childCanvasId!==undefined||s.childRouteId!==undefined)fail(`${at}: child call without matching module`);
      }
    }
  }
  if(!acyclic(ids,children))fail('Child canvas cycle');
  for(const [id,count] of parents)if(count!==(id===project.rootCanvasId?0:1))fail(`Canvas ${id}: expected a single-parent rooted tree`);
  const reached=new Set(),queue=[[project.rootCanvasId,1]],next=new Map(ids.map(id=>[id,[]]));for(const [a,b] of children)next.get(a)?.push(b);
  for(let i=0;i<queue.length;i++) {const [id,depth]=queue[i];if(reached.has(id))continue;reached.add(id);stats.maxDepth=Math.max(stats.maxDepth,depth);for(const child of next.get(id)??[])queue.push([child,depth+1]);}
  if(ids.some(id=>!reached.has(id)))fail('Unreachable canvas');
  return {valid:errors.length===0,errors,stats};
}
export function checkFile(path) {
  try {return validate(JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,'')));}
  catch(error){return {valid:false,errors:[error.message],stats:{}};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const report=process.argv.length===3?checkFile(process.argv[2]):{valid:false,errors:['Usage: node check.mjs project.json'],stats:{}};
  console.log(JSON.stringify(report,null,2));if(!report.valid)process.exitCode=1;
}
