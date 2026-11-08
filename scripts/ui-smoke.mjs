import fs from 'node:fs/promises';
const pages=await(await fetch('http://127.0.0.1:9337/json/list')).json();const ws=new WebSocket(pages[0].webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let seq=0;const pending=new Map();const errors=[];ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.method==='Runtime.exceptionThrown')errors.push(v.params.exceptionDetails.text);if(v.id){const p=pending.get(v.id);if(p){pending.delete(v.id);v.error?p.reject(v.error):p.resolve(v.result)}}};
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value}
async function until(expression){const end=Date.now()+5000;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,40))}throw Error('Condition failed: '+expression)}
async function click(text){await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button');b.click()})()`)}
try{
 await call('Runtime.enable');await until('document.querySelectorAll("canvas").length>0');
 if(!await evaluate('!!window.paperApi'))throw Error('Preload missing');
 await click('插入 / 编辑公式');await until('!!document.querySelector(".formula-preview .katex")');await click('确认插入');await until('!document.querySelector(".modal")');
 await click('单步进入');await click('单步进入');await click('单步进入');await until('document.querySelector(".callstack").innerText.includes("DiT · one illustrative block")');
 await click('上一步');await until('!document.querySelector(".callstack").innerText.includes("DiT · one illustrative block")');
 await click('重置');await click('＋ 路线');await until('!!document.querySelector("form.modal input")');await evaluate(`(()=>{const input=document.querySelector('form.modal input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Smoke route');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await evaluate("document.querySelector('form.modal').requestSubmit()");await until("document.querySelector('.right select').selectedOptions[0].textContent==='Smoke route'");
await click('校验项目');await until('document.querySelector(".status").textContent.includes("检查通过")');
 const text=await evaluate('document.body.innerText');await fs.writeFile('artifacts/ui-smoke.json',JSON.stringify({formulaInserted:true,stepInto:true,stepBack:true,validation:true,exceptions:errors,text},null,2));if(errors.length)throw Error(errors.join(';'));console.log('Actual Electron UI smoke passed: formula preview/insertion, into nested canvas, step back, validation; no JS exceptions');
 const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('artifacts/ui-smoke.png',Buffer.from(shot.data,'base64'));
}finally{ws.close()}
