import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const client=new Client({name:'paper-canvas-smoke',version:'1'});
await client.connect(new StdioClientTransport({command:process.execPath,args:['scripts/mcp-server.mjs']}));
try{
 const tools=await client.listTools();assert.equal(tools.tools.length,5);
 const call=async(name,args={})=>{const response=await client.callTool({name,arguments:args});assert.ok(!response.isError,JSON.stringify(response));return JSON.parse(response.content[0].text)};
 const info=await call('inspect');assert.ok(info.canvases.length>=3);const c=await call('read_canvas',{canvasId:info.activeCanvasId});assert.ok(c.elements.length>0);
 const result=await call('validate');assert.deepEqual(result.errors,[]);
 const applied=await call('apply_canvas',{expectedRevision:info.revision,canvas:c});assert.equal(applied.revision,info.revision+1);
 const stale=await client.callTool({name:'apply_canvas',arguments:{expectedRevision:info.revision,canvas:c}});assert.equal(stale.isError,true);
 await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/mcp-smoke.json',JSON.stringify({tools:tools.tools.map(t=>t.name),canvasCount:info.canvases.length,applied,staleRejected:stale.isError,validation:result},null,2));console.log('MCP real stdio → authenticated HTTP → Electron → React passed: 5 tools, read, validate, revisioned write, stale rejection');
}finally{await client.close()}
