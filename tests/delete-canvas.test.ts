import assert from 'node:assert/strict';
import test from 'node:test';
import type { Canvas, Project } from '../src/shared/types.ts';
import { createProject, validateProject } from '../src/domain/project.ts';
import { deleteCanvas } from '../src/domain/delete-canvas.ts';

test('rejects root, unknown IDs and invalid projects atomically', () => {
  const project = createProject(), before = structuredClone(project);
  for (const id of ['root', 'missing', 'toString', '__proto__']) assert.throws(() => deleteCanvas(project, id), /root|Missing canvas/);
  assert.throws(() => deleteCanvas({} as Project, 'ghost'), /Invalid project/);
  assert.deepEqual(project, before);
});

test('retains externally shared descendants and their descendants, including route-only and detached owners', () => {
  const project = createProject();
  const branch = canvas(project, 'branch'), shared = canvas(project, 'shared');
  const outside = canvas(project, 'outside');
  canvas(project, 'shared-leaf');
  canvas(project, 'exclusive');
  link(branch, 'shared'); link(branch, 'exclusive'); link(shared, 'shared-leaf');
  outside.elements.push(element('call'));
  shared.routes = [{ id: 'forward', name: 'Forward', color: 'blue', steps: [] }];
  outside.routes = [{ id: 'route', name: 'Route', color: 'blue', steps: [{ id: 's', label: '', elementId: 'call', childCanvasId: 'shared', childRouteId: 'forward' }] }];
  const next = deleteCanvas(project, 'branch');
  assert.deepEqual(Object.keys(next.canvases).sort(), ['outside', 'root', 'shared', 'shared-leaf']);
  assert.deepEqual(next.canvases.shared, shared);
  assert.deepEqual(validateProject(next), []);
});

test('removes repeated entries, tombstones boxes/text and attached arrows, cleans reciprocal bindings and routes', () => {
  const project = createProject(), root = project.canvases.root;
  const target = canvas(project, 'target');
  target.routes = [{ id: 'child-route', name: 'Child', color: 'red', steps: [] }];
  link(root, 'target', 'first'); link(root, 'target', 'second');
  const outside = canvas(project, 'outside'); link(outside, 'target', 'third');
  (root.elements[0] as any).boundElements = [{ id: 'label', type: 'text' }, { id: 'arrow', type: 'arrow' }];
  root.elements.push(element('label', { type: 'text', containerId: 'first', text: 'Target' }),
    element('other', { boundElements: [{ id: 'arrow', type: 'arrow' }, { id: 'keep-label', type: 'text' }] }),
    element('keep-label', { type: 'text', containerId: 'other' }),
    element('arrow', { type: 'arrow', startBinding: { elementId: 'first' }, endBinding: { elementId: 'other' }, boundElements: [{ id: 'arrow-label', type: 'text' }] }),
    element('arrow-label', { type: 'text', containerId: 'arrow' }),
    element('loose-label', { type: 'text', containerId: 'second' }),
    element('call'), element('unrelated-arrow', { type: 'arrow' }));
  root.appState = { selectedElementIds: { first: true, label: true, other: true }, scrollX: 42 };
  const step = (id: string, elementId: string, call = false) => ({ id, label: id, elementId, ...(call ? { childCanvasId: 'target', childRouteId: 'child-route' } : {}) });
  root.routes = [{ id: 'r', name: 'Route', color: 'red', steps: [step('box', 'first', true), step('text', 'label'), step('arrow', 'arrow'), step('arrow-text', 'arrow-label'), step('call', 'call', true), step('keep', 'other')] }];
  const before = structuredClone(project), next = deleteCanvas(project, 'target');
  assert.deepEqual(project, before);
  assert.equal(next.revision, project.revision + 1);
  assert.deepEqual(next.canvases.root.modules, {});
  assert.deepEqual(next.canvases.outside.modules, {});
  const elements = next.canvases.root.elements as any[];
  for (const id of ['first', 'second', 'label', 'loose-label', 'arrow', 'arrow-label']) {
    const e = elements.find(e => e.id === id);
    assert.equal(e.isDeleted, true, id);
    assert.equal(e.version, 2, id);
    assert.deepEqual(e.boundElements, [], id);
    assert.equal(e.containerId ?? null, null);
    assert.equal(e.startBinding ?? null, null);
    assert.equal(e.endBinding ?? null, null);
  }
  assert.equal((next.canvases.outside.elements[0] as any).isDeleted, true);
  assert.deepEqual(elements.find(e => e.id === 'other').boundElements, [{ id: 'keep-label', type: 'text' }]);
  assert.equal(elements.find(e => e.id === 'unrelated-arrow').isDeleted, false);
  assert.deepEqual(next.canvases.root.routes[0].steps, [step('call', 'call'), step('keep', 'other')]);
  assert.deepEqual(next.canvases.root.appState, { selectedElementIds: { other: true }, scrollX: 42 });
  assert.deepEqual(validateProject(next), []);
});

test('module-shared nodes survive while diamonds shared only inside the deleted branch do not', () => {
  const project = createProject();
  const branch = canvas(project, 'branch'), left = canvas(project, 'left'), right = canvas(project, 'right');
  canvas(project, 'diamond'); canvas(project, 'shared');
  link(project.canvases.root, 'branch'); link(project.canvases.root, 'shared');
  link(branch, 'left'); link(branch, 'right'); link(branch, 'shared');
  link(left, 'diamond'); link(right, 'diamond');
  const next = deleteCanvas(project, 'branch');
  assert.deepEqual(Object.keys(next.canvases).sort(), ['root', 'shared']);
  assert.equal(Object.values(next.canvases.root.modules)[0].childCanvasId, 'shared');
  assert.deepEqual(validateProject(next), []);
});

const element = (id: string, extra = {}) => ({ id, type: 'rectangle', x: 0, y: 0, width: 100, height: 60, version: 1, versionNonce: 1, isDeleted: false, ...extra });
function canvas(project: Project, id: string): Canvas {
  return project.canvases[id] = { id, title: id, elements: [], modules: {}, routes: [], files: {}, appState: {} };
}
function link(parent: Canvas, child: string, id = child) {
  parent.elements.push(element(id));
  parent.modules[id] = { elementId: id, childCanvasId: child, title: child };
}

test('deletes a detached ghost hierarchy without touching unrelated detached canvases or the input', () => {
  const project = createProject();
  const ghost = canvas(project, 'ghost');
  canvas(project, 'ghost-detail');
  canvas(project, 'unrelated');
  link(ghost, 'ghost-detail');
  const before = structuredClone(project);
  const next = deleteCanvas(project, 'ghost');
  assert.deepEqual(Object.keys(next.canvases).sort(), ['root', 'unrelated']);
  assert.deepEqual(project, before);
  assert.notEqual(next, project);
  assert.equal(next.revision, project.revision + 1);
  assert.deepEqual(validateProject(next), []);
  next.canvases.root.title = 'Independent result';
  assert.equal(project.canvases.root.title, 'Overview');
});
