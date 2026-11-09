#!/usr/bin/env node
// Copy this script together with check.mjs; only Node builtins are required.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LIMITS, wrapText, acyclic, validate } from './check.mjs';
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const nonempty=v=>typeof v==='string'&&v.trim().length>0;
const id=(kind,...parts)=>`${kind}-${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32)}`;
const ensure=(condition,message)=>{if(!condition)throw new Error(message);};
function base(id,type,x,y,width,height) {
  return {id,type,x,y,width,height,angle:0,strokeColor:'#334155',backgroundColor:'transparent',fillStyle:'solid',strokeWidth:2,strokeStyle:'solid',roughness:1,opacity:100,groupIds:[],frameId:null,roundness:null,seed:17,version:1,versionNonce:1,isDeleted:false,boundElements:null,updated:1,link:null,locked:false};
}
function makeText(key,value,x,y,size,maxWidth,maxLines,containerId=null) {
  const measured=wrapText(value,size,maxWidth,maxLines);
  return {...base(key,'text',x+(maxWidth-measured.width)/2,y,measured.width,measured.height),text:measured.text,originalText:value,fontSize:size,fontFamily:5,textAlign:'center',verticalAlign:containerId?'middle':'top',containerId,autoResize:true,lineHeight:1.35};
}
export function build(spec) {
  ensure(obj(spec),'Spec must be an object');
  ensure(nonempty(spec.title)&&nonempty(spec.root),'title and root are required');
  ensure(Array.isArray(spec.canvases)&&spec.canvases.length,'canvases must be nonempty array');
  const map=new Map(),normalized=new Map();
  for(const c of spec.canvases) {
    ensure(obj(c)&&nonempty(c.id)&&nonempty(c.title),'Canvas id/title required');
    ensure(!map.has(c.id),`Duplicate canvas ${c.id}`);map.set(c.id,c);
    ensure(Array.isArray(c.nodes)&&c.nodes.length,`Canvas ${c.id}: empty nodes`);
    const nodes=new Map();
    for(const n of c.nodes) {
      ensure(obj(n)&&nonempty(n.id)&&nonempty(n.label),`Canvas ${c.id}: invalid node id/label`);
      ensure(!nodes.has(n.id),`Canvas ${c.id}: duplicate node ${n.id}`);nodes.set(n.id,n);
      ensure(n.child===undefined||nonempty(n.child),`Node ${n.id}: child must be nonempty string`);
      ensure(n.detail===undefined||nonempty(n.detail),`Node ${n.id}: detail must be nonempty string`);
    }
    const route=c.route===undefined?c.nodes.map(n=>n.id):c.route;
    ensure(Array.isArray(route)&&route.length&&route.every(key=>nodes.has(key))&&new Set(route).size===route.length,`Canvas ${c.id}: invalid/empty/repeated route node`);
    const edges=c.edges===undefined?c.nodes.slice(1).map((n,i)=>[c.nodes[i].id,n.id]):c.edges;
    ensure(Array.isArray(edges),`Canvas ${c.id}: edges must be array`);
    const pairs=new Set();
    for(const edge of edges) {
      ensure(Array.isArray(edge)&&edge.length===2&&nodes.has(edge[0])&&nodes.has(edge[1])&&edge[0]!==edge[1],`Canvas ${c.id}: missing/invalid edge node`);
      const pair=JSON.stringify(edge);ensure(!pairs.has(pair),`Canvas ${c.id}: duplicate edge`);pairs.add(pair);
    }
    normalized.set(c.id,{nodes,route,edges});
  }
  ensure(map.has(spec.root),'Missing root canvas');
  const tree=[],parents=new Map([...map.keys()].map(key=>[key,0]));
  for(const c of spec.canvases)for(const n of c.nodes)if(n.child!==undefined) {
    ensure(map.has(n.child),`Missing child canvas ${n.child}`);tree.push([c.id,n.child]);parents.set(n.child,parents.get(n.child)+1);
  }
  ensure(acyclic([...map.keys()],tree),'Child canvas cycle');
  for(const [key,count] of parents)ensure(count===(key===spec.root?0:1),`Canvas ${key}: not a single-parent rooted tree (or unreachable)`);
  // Kahn orders DAGs; feedback graphs fall back to the complete input node order.
  const project={schemaVersion:1,id:id('project',spec.root,spec.title),title:spec.title,rootCanvasId:id('canvas',spec.root),revision:0,canvases:{}};
  for(const c of spec.canvases) {
    const cid=id('canvas',c.id),{nodes,route,edges}=normalized.get(c.id);
    const indegree=new Map([...nodes.keys()].map(key=>[key,0])),out=new Map([...nodes.keys()].map(key=>[key,[]]));
    for(const [a,b]of edges){indegree.set(b,indegree.get(b)+1);out.get(a).push(b);}
    const order=[...nodes.keys()].filter(key=>indegree.get(key)===0);
    for(let i=0;i<order.length;i++)for(const b of out.get(order[i])){indegree.set(b,indegree.get(b)-1);if(indegree.get(b)===0)order.push(b);}
    if(order.length!==nodes.size)order.splice(0,order.length,...nodes.keys());
    const elements=[],modules={},position=new Map();
    // Left routing channels are reserved before placing the vertical pipeline.
    const x=120+edges.length*26;
    const heading=makeText(id('heading',c.id),c.title,x-100,48,28,900,3);elements.push(heading);
    let y=heading.y+heading.height+80;
    for(const key of order) {
      const n=nodes.get(key),nid=id('node',c.id,n.id);
      const label=makeText(id('label',c.id,n.id),n.label,x+20,0,20,380,8,nid);
      const height=Math.max(76,label.height+40);label.y=y+(height-label.height)/2;
      const box={...base(nid,'rectangle',x,y,420,height),backgroundColor:n.child?'#dbeafe':'#f1f5f9',strokeColor:'#2563eb',roundness:{type:3},boundElements:[{id:label.id,type:'text'}]};
      elements.push(box,label);position.set(n.id,box);
      let occupied=height;
      if(n.detail!==undefined) {
        const detail=makeText(id('detail',c.id,n.id),n.detail,x+480,y,16,360,10);elements.push(detail);occupied=Math.max(occupied,detail.height);
      }
      if(n.child!==undefined)modules[nid]={elementId:nid,childCanvasId:id('canvas',n.child),title:n.label,source:'Declarative architecture specification'};
      y+=occupied+100;
    }
    edges.forEach(([source,target],i)=>{
      const a=position.get(source),b=position.get(target),aid=id('arrow',c.id,source,target);
      const adjacent=order.indexOf(target)===order.indexOf(source)+1;
      let ax,ay,points;
      if(adjacent) {
        ax=a.x+a.width/2;ay=a.y+a.height+10;points=[[0,0],[0,b.y-10-ay]];
      } else {
        // Nonadjacent forward edges and feedback/back edges use distinct left lanes.
        ax=a.x-10;ay=a.y+a.height/2;
        const lane=80+i*26;points=[[0,0],[lane-ax,0],[lane-ax,b.y+b.height/2-ay],[b.x-10-ax,b.y+b.height/2-ay]];
      }
      elements.push({...base(aid,'arrow',ax,ay,Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]))),strokeColor:'#2563eb',points,startBinding:{elementId:a.id,focus:0,gap:10},endBinding:{elementId:b.id,focus:0,gap:10},startArrowhead:null,endArrowhead:'arrow',elbowed:false});
      a.boundElements.push({id:aid,type:'arrow'});b.boundElements.push({id:aid,type:'arrow'});
    });
    project.canvases[cid]={id:cid,title:c.title,elements,files:{},appState:{viewBackgroundColor:'#ffffff',gridSize:null,currentItemFontFamily:5,currentItemRoughness:1},modules,routes:[{id:id('route',c.id),name:'Forward · 架构流程',color:'#2563eb',steps:route.map(key=>{
      const n=nodes.get(key);return {id:id('step',c.id,key),elementId:id('node',c.id,key),label:n.label,...(n.child!==undefined?{childCanvasId:id('canvas',n.child),childRouteId:id('route',n.child)}:{})};
    })}]};
  }
  const report=validate(project);ensure(report.valid,report.errors.join('; '));return project;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    ensure(process.argv.length===4,'Usage: node build.mjs spec.json output.json');
    const spec=JSON.parse(readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
    const project=build(spec),report=validate(project);
    writeFileSync(process.argv[3],JSON.stringify(project,null,2)+'\n',{encoding:'utf8',flag:'wx'});
    console.log(JSON.stringify({...report,output:resolve(process.argv[3])},null,2));
  }catch(error){console.log(JSON.stringify({valid:false,errors:[error.message],stats:{}},null,2));process.exitCode=1;}
}
