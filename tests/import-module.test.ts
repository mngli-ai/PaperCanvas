import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoProject, createProject, validateProject } from '../src/domain/project.ts';
import { importProjectAsModule, sceneAsProject } from '../src/domain/import-module.ts';

const rect = (id: string, extra = {}) => ({ id, type: 'rectangle', x: 12, y: -5, width: 120, height: 60, ...extra });

test('repeated imports clone the whole hierarchy independently without changing either input or layout', () => {
  const source = createDemoProject();
  const target = createProject();
  target.canvases.root.elements.push(rect('existing'));
  const beforeSource = structuredClone(source), beforeTarget = structuredClone(target);
  const once = importProjectAsModule(target, 'root', source, { x: 500, y: 300 });
  const twice = importProjectAsModule(once, 'root', source, { x: 700, y: 400 }, 'Second');
  assert.deepEqual(source, beforeSource);
  assert.deepEqual(target, beforeTarget);
  assert.equal(once.revision, target.revision + 1);
  assert.equal(twice.revision, target.revision + 2);
  assert.equal(Object.keys(twice.canvases).length, 7);
  assert.deepEqual(twice.canvases.root.elements[0], target.canvases.root.elements[0]);
  const links = Object.values(twice.canvases.root.modules);
  assert.equal(links.length, 2);
  assert.notEqual(links[0].childCanvasId, links[1].childCanvasId);
  const ids = new Set<string>();
  for (const canvas of Object.values(twice.canvases)) {
    for (const e of canvas.elements as any[]) { assert.ok(!ids.has(e.id)); ids.add(e.id); }
    for (const route of canvas.routes) for (const step of route.steps) {
      if (step.childCanvasId) assert.ok(twice.canvases[step.childCanvasId].routes.some(r => r.id === step.childRouteId));
    }
  }
  const imported = twice.canvases[links[0].childCanvasId];
  assert.notEqual(imported.routes[0].id, source.canvases.root.routes[0].id);
  assert.notEqual(imported.routes[0].steps[0].id, source.canvases.root.routes[0].steps[0].id);
  assert.equal(imported.routes[0].steps[0].elementId, (imported.elements as any[]).find(e => e.id === imported.routes[0].steps[0].elementId)?.id);
  for (const module of Object.values(imported.modules)) {
    assert.ok(twice.canvases[module.childCanvasId]);
    assert.ok((imported.elements as any[]).some(e => e.id === module.elementId));
    assert.ok(!Object.values(source.canvases.root.modules).some(original => original.childCanvasId === module.childCanvasId));
  }
  assert.deepEqual(imported.elements.map((e: any) => [e.x, e.y, e.width, e.height]), source.canvases.root.elements.map((e: any) => [e.x, e.y, e.width, e.height]));
  for (const canvas of Object.values(twice.canvases)) for (const e of canvas.elements as any[]) {
    if (e.type === 'image') {
      const file = canvas.files[e.fileId] as any;
      assert.ok(file.dataURL.startsWith('data:image/png;base64,'));
      assert.ok(e.customData.paperCanvas.latex);
    }
  }
  const box = once.canvases.root.elements[1] as any, label = once.canvases.root.elements[2] as any;
  assert.equal(box.x + box.width / 2, 500);
  assert.equal(box.y + box.height / 2, 300);
  assert.equal(box.roughness, 1);
  assert.equal(label.fontFamily, 5);
  assert.equal(label.textAlign, 'center');
  assert.equal(label.verticalAlign, 'middle');
  assert.equal(label.containerId, box.id);
  assert.deepEqual(box.boundElements, [{ id: label.id, type: 'text' }]);
  assert.deepEqual(validateProject(twice), []);
  imported.elements.length = 0;
  assert.deepEqual(source, beforeSource);
  assert.ok(twice.canvases[links[1].childCanvasId].elements.length > 0);
});

test('remaps frame, groups, binding, container, files and selection without rewriting formula source', () => {
  const source = createProject();
  source.canvases.root.elements = [rect('frame', { type: 'frame' }), rect('box', { frameId: 'frame', groupIds: ['g'], boundElements: [{ id: 'text', type: 'text' }, { id: 'arrow', type: 'arrow' }] }), rect('text', { type: 'text', containerId: 'box', groupIds: ['g'], text: 'box', customData: { paperCanvas: { latex: 'box', source: 'frame' } } }), rect('arrow', { type: 'arrow', startBinding: { elementId: 'box', focus: 0 }, endBinding: { elementId: 'frame' } }), rect('image', { type: 'image', fileId: 'file' })];
  source.canvases.root.files = { file: { id: 'file', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==', created: 1 } };
  source.canvases.root.appState = { selectedElementIds: { box: true }, selectedGroupIds: { g: true }, editingGroupId: 'g', scrollX: 123, zoom: { value: 2 } };
  const next = importProjectAsModule(createProject(), 'root', source, { x: 0, y: 0 });
  const canvas = next.canvases[Object.values(next.canvases.root.modules)[0].childCanvasId];
  const [frame, box, text, arrow, image] = canvas.elements as any[];
  for (const [i, e] of (canvas.elements as any[]).entries()) assert.notEqual(e.id, (source.canvases.root.elements[i] as any).id);
  assert.equal(box.frameId, frame.id);
  assert.equal(box.boundElements[0].id, text.id);
  assert.equal(box.boundElements[1].id, arrow.id);
  assert.equal(text.containerId, box.id);
  assert.equal(arrow.startBinding.elementId, box.id);
  assert.equal(arrow.endBinding.elementId, frame.id);
  assert.equal(box.groupIds[0], text.groupIds[0]);
  assert.notEqual(box.groupIds[0], 'g');
  assert.deepEqual(text.customData, { paperCanvas: { latex: 'box', source: 'frame' } });
  assert.equal(text.text, 'box');
  assert.notEqual(image.fileId, 'file');
  assert.equal((canvas.files[image.fileId] as any).id, image.fileId);
  assert.deepEqual(canvas.appState.selectedElementIds, { [box.id]: true });
  assert.deepEqual(canvas.appState.selectedGroupIds, { [box.groupIds[0]]: true });
  assert.equal(canvas.appState.editingGroupId, box.groupIds[0]);
  assert.equal(canvas.appState.scrollX, 123);
});

test('scene conversion accepts JSON or parsed Excalidraw scenes, keeps files and rejects malformed input', () => {
  const scene = { type: 'excalidraw', version: 2, elements: [rect('box')], files: {}, appState: { scrollX: 23 } };
  const before = structuredClone(scene);
  const converted = sceneAsProject(scene, 'Scene');
  assert.equal(converted.title, 'Scene');
  assert.deepEqual(converted.canvases[converted.rootCanvasId].elements, scene.elements);
  assert.deepEqual(validateProject(sceneAsProject(JSON.stringify(scene))), []);
  converted.canvases[converted.rootCanvasId].elements.length = 0;
  assert.deepEqual(scene, before);
  for (const bad of ['{', null, [], {}, { ...scene, type: 'excalidrawlib' }, { ...scene, elements: [rect('x', { width: -1 })] }]) assert.throws(() => sceneAsProject(bad));
});

test('rejects invalid project, target, title and coordinates atomically', () => {
  const target = createProject(), source = createProject(), before = structuredClone(target);
  assert.throws(() => importProjectAsModule(target, 'missing', source, { x: 0, y: 0 }));
  assert.throws(() => importProjectAsModule(target, 'root', source, { x: NaN, y: 0 }));
  assert.throws(() => importProjectAsModule(target, 'root', source, { x: 0, y: 0 }, ' '));
  assert.throws(() => importProjectAsModule(target, 'root', {} as any, { x: 0, y: 0 }));
  assert.deepEqual(target, before);
});
