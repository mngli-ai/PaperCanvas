import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateProject } from '../src/domain/project.ts';

const scripts = fileURLToPath(new URL('../skills/papercanvas-architecture/scripts/', import.meta.url));
function fixture() {
  return { title: '中文架构 Pipeline', root: 'root', canvases: [
    { id: 'root', title: '总览', nodes: [{id:'a',label:'中文输入'}, {id:'b',label:'Attention long label '.repeat(5),child:'block',detail:'辅助说明 ' .repeat(20)}, {id:'c',label:'输出'}], edges:[['a','b'],['b','c'],['a','c']], route:['a','b','c'] },
    { id: 'block', title: '模块', nodes: [{id:'a',label:'投影',child:'deep'}] },
    { id: 'deep', title: '深层', nodes: [{id:'a',label:'内核',child:'leaf'}] },
    { id: 'leaf', title: '第四层', nodes: [{id:'a',label:'W'.repeat(60)}] },
  ] };
}
function run(script:string, args:string[]) { return spawnSync(process.execPath,[join(scripts,script),...args],{encoding:'utf8'}); }
function sandbox(fn:(dir:string)=>void) { const dir=mkdtempSync(join(tmpdir(),'pc-architecture-'));try{fn(dir);}finally{rmSync(dir,{recursive:true,force:true});} }

test('standalone build: schema, four levels, bindings, deterministic IDs, exclusive output',()=>sandbox(dir=>{
  const input=join(dir,'spec.json'), output=join(dir,'out.json');writeFileSync(input,JSON.stringify(fixture()));
  const built=run('build.mjs',[input,output]);assert.equal(built.status,0,built.stdout+built.stderr);
  const p=JSON.parse(readFileSync(output,'utf8'));assert.deepEqual(validateProject(p),[]);
  const checked=run('check.mjs',[output]);assert.equal(checked.status,0,checked.stdout+checked.stderr);assert.equal(JSON.parse(checked.stdout).valid,true);
  const root=p.canvases[p.rootCanvasId];assert.ok(root.routes[0].steps[1].childRouteId);
  const label=root.elements.find((e:any)=>e.type==='text' && e.containerId);assert.equal(label.fontFamily,5);assert.equal(label.verticalAlign,'middle');
  const arrows=root.elements.filter((e:any)=>e.type==='arrow');assert.equal(arrows.length,3);assert.ok(arrows.every((e:any)=>e.startBinding&&e.endBinding));
  assert.equal(run('build.mjs',[input,output]).status,1);const second=join(dir,'second.json');assert.equal(run('build.mjs',[input,second]).status,0);assert.equal(readFileSync(output,'utf8'),readFileSync(second,'utf8'));
  copyFileSync(join(scripts,'build.mjs'),join(dir,'build.mjs'));copyFileSync(join(scripts,'check.mjs'),join(dir,'check.mjs'));
  const detached=spawnSync(process.execPath,[join(dir,'build.mjs'),input,join(dir,'portable.json')],{cwd:dir,encoding:'utf8'});assert.equal(detached.status,0,detached.stdout+detached.stderr);
}));

test('unbounded hierarchy, CRLF, prototype-like IDs and reordered DAG flow',()=>sandbox(dir=>{
  const spec={title:'深层',root:'c0',canvases:Array.from({length:40},(_,i)=>({id:'c'+i,title:'层'+i,nodes:[{id:'__proto__',label:'多行\r\n安全名称',...(i<39?{child:'c'+(i+1)}:{})}]}))};
  const input=join(dir,'deep.json'),output=join(dir,'deep-out.json');writeFileSync(input,JSON.stringify(spec));
  const result=run('build.mjs',[input,output]);assert.equal(result.status,0,result.stdout);assert.equal(JSON.parse(result.stdout).stats.maxDepth,40);
  const dag={title:'DAG',root:'r',canvases:[{id:'r',title:'分支',nodes:[{id:'end',label:'输出'},{id:'branch',label:'分支'},{id:'start',label:'开始'}],edges:[['start','end'],['start','branch'],['branch','end']],route:['start','branch','end']}]};
  writeFileSync(input,JSON.stringify(dag));const out=join(dir,'dag.json');const result2=run('build.mjs',[input,out]);assert.equal(result2.status,0,result2.stdout);assert.equal(run('check.mjs',[out]).status,0);
}));

test('cyclic sampling feedback keeps deterministic input order and reserved left lanes; child cycles still fail',()=>sandbox(dir=>{
  const spec:any=fixture();
  // An independent zero-indegree node makes Kahn partially succeed before the cycle.
  spec.canvases[0].nodes.push({id:'independent',label:'条件输入'});
  spec.canvases[0].edges.push(['c','b']);
  const input=join(dir,'feedback.json'),output=join(dir,'feedback-out.json');
  writeFileSync(input,JSON.stringify(spec));
  const result=run('build.mjs',[input,output]);assert.equal(result.status,0,result.stdout+result.stderr);
  const p=JSON.parse(readFileSync(output,'utf8')),c=p.canvases[p.rootCanvasId];
  assert.deepEqual(validateProject(p),[]);
  const checked=run('check.mjs',[output]);assert.equal(checked.status,0,checked.stdout+checked.stderr);
  const boxes=c.elements.filter((e:any)=>e.type==='rectangle');
  const labels=boxes.map((b:any)=>c.elements.find((e:any)=>e.containerId===b.id).originalText);
  assert.deepEqual(labels,spec.canvases[0].nodes.map((n:any)=>n.label));
  assert.ok(boxes.every((b:any,i:number)=>i===0||b.y>boxes[i-1].y+boxes[i-1].height));
  const back=c.elements.find((e:any)=>e.type==='arrow'&&e.startBinding.elementId===boxes[2].id&&e.endBinding.elementId===boxes[1].id);
  assert.ok(back);assert.equal(back.points.length,4);
  assert.ok(back.y>back.y+back.points.at(-1)[1]);
  const lane=back.x+back.points[1][0];assert.ok(lane<Math.min(...boxes.map((b:any)=>b.x))-10);
  assert.equal(lane,back.x+back.points[2][0]);
  const second=join(dir,'feedback-second.json');assert.equal(run('build.mjs',[input,second]).status,0);
  assert.equal(readFileSync(output,'utf8'),readFileSync(second,'utf8'));
  spec.canvases[3].nodes[0].child='root';writeFileSync(input,JSON.stringify(spec));
  const rejected=run('build.mjs',[input,join(dir,'child-cycle.json')]);
  assert.equal(rejected.status,1);assert.match(rejected.stdout,/Child canvas cycle/);
  const leaf=Object.values(p.canvases).find((canvas:any)=>canvas.title==='第四层') as any;
  const node=leaf.elements.find((e:any)=>e.type==='rectangle');
  leaf.modules[node.id]={elementId:node.id,childCanvasId:p.rootCanvasId,title:'循环'};
  writeFileSync(output,JSON.stringify(p));
  const childCheck=run('check.mjs',[output]);assert.equal(childCheck.status,1);assert.match(childCheck.stdout,/Child canvas cycle/);
}));

test('reject malformed specs before creating output',()=>sandbox(dir=>{
  const mutations=[
    (s:any)=>s.canvases[0].nodes=[],
    (s:any)=>s.canvases[3].nodes[0].child='root',
    (s:any)=>s.canvases[0].nodes[1].child='missing',
    (s:any)=>s.canvases[0].route=['missing'],
    (s:any)=>s.canvases[0].nodes[0].label='字'.repeat(1000),
    (s:any)=>s.canvases[0].edges.push(['a','b']),
    (s:any)=>s.canvases[0].nodes.push({...s.canvases[0].nodes[0]}),
    (s:any)=>s.canvases.push({id:'orphan',title:'孤立',nodes:[{id:'a',label:'a'}]}),
    (s:any)=>s.canvases[0].nodes[2].child='block',
  ];
  mutations.forEach((mutate,i)=>{const s=fixture();mutate(s);const input=join(dir,`${i}.json`);writeFileSync(input,JSON.stringify(s));const r=run('build.mjs',[input,join(dir,`${i}.out.json`)]);assert.equal(r.status,1,r.stdout);assert.equal(JSON.parse(r.stdout).valid,false);});
}));

test('checker rejects geometry, binding, ID, routes, trees, long wraps and malformed JSON',()=>sandbox(dir=>{
  const input=join(dir,'spec.json'),output=join(dir,'out.json');writeFileSync(input,JSON.stringify(fixture()));assert.equal(run('build.mjs',[input,output]).status,0);
  const original=JSON.parse(readFileSync(output,'utf8'));
  const mutations=[
    (p:any,c:any)=>c.elements.find((e:any)=>e.type==='text'&&e.containerId).width=1,
    (p:any,c:any)=>c.elements.find((e:any)=>e.type==='text'&&e.containerId).fontFamily=1,
    (p:any,c:any)=>c.elements.find((e:any)=>e.type==='rectangle').boundElements=[],
    (p:any,c:any)=>c.elements.find((e:any)=>e.type==='arrow').endBinding.elementId='missing',
    (p:any,c:any)=>{const rs=c.elements.filter((e:any)=>e.type==='rectangle');rs[1].x=rs[0].x;rs[1].y=rs[0].y;},
    (p:any,c:any)=>c.routes[0].steps[0].elementId='missing',
    (p:any,c:any)=>c.routes[0].steps[1].childRouteId='missing',
    (p:any,c:any)=>c.routes[0].steps[1].childCanvasId=undefined,
    (p:any,c:any)=>c.elements[1].id=c.elements[0].id,
    (p:any,c:any)=>c.elements.find((e:any)=>e.type==='text').text='W'.repeat(1000),
    (p:any,c:any)=>c.elements.find((e:any)=>e.type==='rectangle').width=10000,
    (p:any,c:any)=>c.elements=[],
    (p:any,c:any)=>c.modules[Object.keys(c.modules)[0]].childCanvasId=p.rootCanvasId,
  ];
  mutations.forEach((mutate,i)=>{const p=structuredClone(original);mutate(p,p.canvases[p.rootCanvasId]);const path=join(dir,`bad-${i}.json`);writeFileSync(path,JSON.stringify(p));const r=run('check.mjs',[path]);assert.equal(r.status,1,`mutation ${i}: ${r.stdout}`);assert.equal(JSON.parse(r.stdout).valid,false);});
  for(const value of ['null','{"canvases":null}','{broken','{"schemaVersion":1,"canvases":{"x":{"elements":[null],"routes":[null],"modules":{"x":null}}}}']){writeFileSync(output,value);const r=run('check.mjs',[output]);assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).valid,false);}
}));
