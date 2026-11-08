import assert from 'node:assert/strict';
import test from 'node:test';
import * as domain from '../src/domain/project.ts';
import type { Project } from '../src/shared/types.ts';

function element(id: string, overrides: Record<string, unknown> = {}) {
  return { id, type: 'rectangle', x: 0, y: 0, width: 100, height: 80, ...overrides };
}

test('canvas updates reject unknown element types without mutating the project', () => {
  const p = domain.createProject();
  const before = structuredClone(p);
  for (const value of [
    { id: 'broken', type: 'not-a-real-excalidraw-type' },
    element('broken', { type: 'not-a-real-excalidraw-type' }),
    element('broken', { type: undefined }),
    element('broken', { type: 'eraser' }),
  ]) {
    const canvas = { ...p.canvases.root, elements: [value] };
    assert.throws(() => domain.updateCanvas(p, canvas), /element.*type/i);
    assert.deepEqual(p, before);
    const malformed = { ...p, canvases: { root: canvas } };
    assert.throws(() => domain.parseProject(JSON.stringify(malformed)), /element.*type/i);
    assert.throws(() => domain.serializeProject(malformed), /element.*type/i);
  }
});

test('edits preserve input, increment revision, and reject broken references/cycles', () => {
  const p = domain.createProject();
  p.canvases.root.elements = [element('module')];
  const before = JSON.stringify(p);
  const next = domain.addChildCanvas(p, 'root', 'module', 'Details');
  assert.equal(JSON.stringify(p), before);
  assert.equal(next.revision, 1);
  const link = next.canvases.root.modules.module;
  assert.equal(link.title, 'Details');
  assert.equal(next.canvases[link.childCanvasId].title, 'Details');
  assert.deepEqual(domain.validateProject(next), []);
  assert.throws(() => domain.addChildCanvas(next, 'root', 'module', 'Again'));
  assert.throws(() => domain.addChildCanvas(p, 'absent', 'module', 'Details'));
  assert.throws(() => domain.addChildCanvas(p, 'root', 'absent', 'Details'));
  assert.throws(() => domain.addChildCanvas(p, 'root', 'module', ''));
  const edited = structuredClone(next.canvases[link.childCanvasId]);
  edited.title = 'Revised';
  const updated = domain.updateCanvas(next, edited);
  assert.equal(updated.revision, 2);
  assert.equal(next.canvases[link.childCanvasId].title, 'Details');
  edited.title = 'External mutation';
  assert.equal(updated.canvases[link.childCanvasId].title, 'Revised');
  assert.throws(() => domain.updateCanvas(next, { ...edited, id: 'missing' }));
  assert.throws(() => domain.updateCanvas(next, { ...next.canvases.root, elements: [] }));
  const cycle = structuredClone(next.canvases[link.childCanvasId]);
  cycle.elements = [element('back')];
  cycle.modules.back = { elementId: 'back', title: 'Back', childCanvasId: 'root' };
  assert.throws(() => domain.updateCanvas(next, cycle), /cycle/i);
  assert.equal(next.revision, 1);
});

test('demo has restorable primitives and explicit root → dit → attention calls', () => {
  const p = domain.createDemoProject();
  assert.deepEqual(domain.validateProject(p), []);
  assert.match(p.title, /illustrative/i);
  assert.equal(p.rootCanvasId, 'root');
  assert.deepEqual(Object.keys(p.canvases).sort(), ['attention', 'dit', 'root']);
  for (const [parent, child] of [['root', 'dit'], ['dit', 'attention']]) {
    const canvas = p.canvases[parent];
    assert.ok(Object.values(canvas.modules).some(m => m.childCanvasId === child));
    assert.ok(canvas.routes.find(r => r.id === 'forward')?.steps.some(s => s.childCanvasId === child && s.childRouteId === 'forward'));
  }
  for (const c of Object.values(p.canvases)) {
    assert.ok(c.routes.find(r => r.id === 'forward')!.steps.length >= 3);
    const elements = c.elements as any[];
    for (const type of ['rectangle', 'text', 'arrow']) assert.ok(elements.some(e => e.type === type));
    for (const e of elements) {
      for (const key of ['x', 'y', 'width', 'height', 'angle', 'seed', 'version', 'versionNonce', 'updated', 'opacity']) assert.ok(Number.isFinite(e[key]), `${e.id}.${key}`);
      assert.equal(e.isDeleted, false);
      assert.ok(Array.isArray(e.groupIds));
      if (e.type === 'arrow') {
        assert.ok(e.points.length >= 2);
        assert.equal(e.endArrowhead, 'arrow');
      }
      if (e.type === 'text') {
        assert.equal(e.originalText, e.text);
        assert.ok(e.fontSize > 0);
      }
    }
  }
  assert.deepEqual(domain.parseProject(domain.serializeProject(p)), p);
  const other = domain.createDemoProject();
  assert.notEqual(p.id, other.id);
  assert.notEqual(p.canvases.root.elements, other.canvases.root.elements);
});

test('element geometry must be finite with nonnegative sizes', () => {
  const p = domain.createProject();
  for (const key of ['x', 'y', 'width', 'height']) {
    for (const value of [undefined, null, '10', NaN, Infinity, -Infinity]) {
      const canvas = { ...p.canvases.root, elements: [element('bad', { [key]: value })] };
      assert.throws(() => domain.updateCanvas(p, canvas), new RegExp(`element.*${key}`, 'i'));
      assert.throws(() => domain.serializeProject({ ...p, canvases: { root: canvas } }), /Invalid project/);
      assert.throws(() => domain.parseProject(JSON.stringify({ ...p, canvases: { root: canvas } })), /Invalid project/);
    }
  }
  for (const key of ['width', 'height']) {
    invalid(p => { p.canvases.root.elements = [element('bad', { [key]: -1 })]; }, new RegExp(key));
  }
});

function file(overrides: Record<string, unknown> = {}) {
  return { id: 'asset', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==', created: 0, ...overrides };
}

test('file entries reject malformed binary data and mismatched ids', () => {
  const p = domain.createProject();
  for (const value of [
    null, [], 'bad', {}, file({ id: 'different' }), file({ mimeType: null }),
    file({ mimeType: 'text/html' }), file({ dataURL: 42 }), file({ dataURL: '' }),
    file({ dataURL: 'https://example.com/image.png' }), file({ created: null }),
    file({ created: NaN }), file({ lastRetrieved: Infinity }), file({ version: '1' }),
  ]) {
    const canvas = { ...p.canvases.root, files: { asset: value } };
    assert.throws(() => domain.updateCanvas(p, canvas), /file/i);
    const malformed = { ...p, canvases: { root: canvas } };
    assert.throws(() => domain.serializeProject(malformed), /file/i);
    assert.throws(() => domain.parseProject(JSON.stringify(malformed)), /file/i);
  }
  for (const files of [null, [], 'bad']) {
    invalid(p => { (p.canvases.root as any).files = files; }, /files/i);
  }
});

test('known Excalidraw types, zero sizes and negative coordinates remain valid', () => {
  const p = domain.createProject();
  p.canvases.root.elements = [
    ...['selection', 'rectangle', 'diamond', 'ellipse', 'text', 'line', 'frame', 'magicframe', 'iframe', 'embeddable']
      .map(type => element(type, { type, x: -10, y: -20, width: 0, height: 0 })),
    element('arrow', { type: 'arrow', width: 20, height: 0, points: [[0, 0], [-20, 0]], startBinding: null, endBinding: null }),
    element('freedraw', { type: 'freedraw', points: [[0, 0]], pressures: [], simulatePressure: true, width: 0, height: 0 }),
    element('image', { type: 'image', fileId: 'asset', status: 'saved', scale: [-1, 1] }),
    element('pending-image', { type: 'image', fileId: null, status: 'pending', scale: [1, 1] }),
  ];
  p.canvases.root.files = { asset: file(), svg: file({ id: 'svg', mimeType: 'image/svg+xml', dataURL: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E', lastRetrieved: 0, version: 1 }) };
  assert.deepEqual(domain.validateProject(p), []);
  assert.deepEqual(domain.parseProject(domain.serializeProject(p)), p);
  assert.equal(domain.updateCanvas(domain.createProject(), p.canvases.root).revision, 1);
});

function invalid(mutator: (p: Project) => void, pattern: RegExp) {
  const p = domain.createProject();
  mutator(p);
  assert.match(domain.validateProject(p).join('\n'), pattern);
  assert.throws(() => domain.parseProject(JSON.stringify(p)), /Invalid project/);
}

test('validate, parse and serialize reject malformed data and round-trip without edits', () => {
  const p = domain.createProject();
  assert.deepEqual(domain.validateProject(p), []);
  assert.deepEqual(domain.parseProject(domain.serializeProject(p)), p);
  assert.equal(p.revision, 0);
  for (const value of [null, [], {}, { schemaVersion: 2 }]) {
    assert.ok(domain.validateProject(value as Project).length);
    assert.throws(() => domain.parseProject(JSON.stringify(value)), /Invalid project/);
  }
  assert.throws(() => domain.parseProject('{bad'), /Invalid project/);
  invalid(p => { p.rootCanvasId = 'missing'; }, /root/i);
  invalid(p => { p.revision = -1; }, /revision/i);
  invalid(p => { p.canvases.root.modules.box = { elementId: 'box', childCanvasId: 'missing', title: 'x' }; }, /element|child/i);
  invalid(p => {
    p.canvases.root.elements = [element('box')];
    p.canvases.root.modules.box = { elementId: 'box', childCanvasId: 'root', title: 'x' };
  }, /cycle/i);
  invalid(p => { p.canvases.root.routes = [{ id: 'f', name: 'f', color: 'blue', steps: [{ id: 's', elementId: 'missing', label: 's' }] }]; }, /element/i);
  invalid(p => { (p.canvases.root as any).routes = null; }, /routes/i);
  invalid(p => { p.canvases.root.elements = [element('dup'), element('dup')]; }, /duplicate/i);
  invalid(p => {
    p.canvases.root.elements = [element('box')];
    p.canvases.root.routes = [{ id: 'forward', name: 'Forward', color: '#000', steps: [{ id: 'call', elementId: 'box', label: 'Call', childCanvasId: 'root', childRouteId: 'absent' }] }];
  }, /child route/i);
  const cycle = domain.createDemoProject();
  cycle.canvases.attention.modules['attention-output'] = { elementId: 'attention-output', childCanvasId: 'root', title: 'Cycle' };
  assert.match(domain.validateProject(cycle).join('\n'), /cycle/i);
  assert.throws(() => domain.serializeProject({} as Project), /Invalid project/);
});

test('createProject creates independent empty root projects', () => {
  const a = domain.createProject();
  const b = domain.createProject();
  assert.equal(a.schemaVersion, 1);
  assert.equal(a.rootCanvasId, 'root');
  assert.equal(a.revision, 0);
  assert.deepEqual(Object.keys(a.canvases), ['root']);
  assert.deepEqual(a.canvases.root.elements, []);
  assert.deepEqual(a.canvases.root.routes, []);
  assert.deepEqual(a.canvases.root.modules, {});
  assert.notEqual(a.id, b.id);
  (a.canvases.root.elements as unknown[]).push({ id: 'local' });
  assert.deepEqual(b.canvases.root.elements, []);
});
