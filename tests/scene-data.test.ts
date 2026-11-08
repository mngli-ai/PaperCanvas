import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeFiles,formulaReplacement} from '../src/renderer/scene-data.ts';
test('canvas resource snapshots exclude foreign files and retain tombstone resources',()=>{const a={id:'a'},b={id:'b'};assert.deepEqual(scopeFiles([{type:'image',fileId:'a',isDeleted:true}],{a,b}),{a})});
test('formula replacement preserves identity, binding, rotation and advances version',()=>{const old={id:'formula',version:4,angle:0.2,groupIds:['g'],boundElements:[{id:'arrow'}],customData:{other:1}};const next=formulaReplacement({id:'generated',version:1,fileId:'fresh',customData:{paperCanvas:{latex:'y'}}},old);assert.equal(next.id,'formula');assert.equal(next.version,5);assert.equal(next.angle,0.2);assert.deepEqual(next.groupIds,['g']);assert.equal(next.customData.other,1);assert.equal(next.fileId,'fresh')});
