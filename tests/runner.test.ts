import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Canvas, Project, Route, Step } from '../src/shared/types.ts';
import { createRunner, currentStep, stepInto, stepOver, stepOut, stepBack } from '../src/runner/runner.ts';

const step = (id: string, extra: Partial<Step> = {}): Step => ({ id, elementId: id, label: id, ...extra });
const route = (id: string, steps: Step[] = []): Route => ({ id, name: id, color: '#336699', steps });
const canvas = (id: string, routes: Route[]): Canvas => ({ id, title: id, elements: [], files: {}, appState: {}, modules: {}, routes });
function fixture(): Project {
  return { schemaVersion: 1, id: 'test', title: 'Test', rootCanvasId: 'root', revision: 0, canvases: {
    root: canvas('root', [route('forward', [step('call', { childCanvasId: 'child', childRouteId: 'forward' }), step('tail')]), route('other', [step('other')]), route('empty')]),
    child: canvas('child', [route('forward', [step('nested', { childCanvasId: 'leaf', childRouteId: 'detail' }), step('child-tail')])]),
    leaf: canvas('leaf', [route('detail', [step('leaf-step')])]),
  } };
}

test('createRunner pauses at the selected route first step, not another named route', () => {
  const p = fixture();
  const state = createRunner(p, 'root', 'other');
  assert.deepEqual(state, { status: 'paused', stack: [{ canvasId: 'root', routeId: 'other', index: 0 }], history: [] });
  assert.deepEqual(currentStep(p, state), { canvasId: 'root', step: p.canvases.root.routes[1].steps[0] });
});

test('into enters explicit nested frames and child completion resumes the parent sibling', () => {
  const p = fixture();
  const first = createRunner(p, 'root', 'forward');
  const child = stepInto(p, first);
  assert.deepEqual(child.stack, [...first.stack, { canvasId: 'child', routeId: 'forward', index: 0 }]);
  const leaf = stepInto(p, child);
  assert.equal(currentStep(p, leaf)?.step.id, 'leaf-step');
  const resumed = stepInto(p, leaf);
  assert.deepEqual(resumed.stack, [{ canvasId: 'root', routeId: 'forward', index: 0 }, { canvasId: 'child', routeId: 'forward', index: 1 }]);
  assert.equal(currentStep(p, resumed)?.step.id, 'child-tail');
});

test('over skips child calls and root completion is rewindable', () => {
  const p = fixture();
  const first = createRunner(p, 'root', 'forward');
  const second = stepOver(p, first);
  assert.equal(currentStep(p, second)?.step.id, 'tail');
  assert.equal(second.stack.length, 1);
  const done = stepOver(p, second);
  assert.equal(done.status, 'completed');
  assert.deepEqual(done.stack, []);
  assert.equal(currentStep(p, done), null);
  assert.deepEqual(stepBack(done), second);
  assert.deepEqual(stepBack(stepBack(done)), first);
  assert.deepEqual(stepBack(first), first);
});

test('out finishes the current frame and advances its caller', () => {
  const p = fixture();
  const first = createRunner(p, 'root', 'forward');
  const child = stepInto(p, first);
  const out = stepOut(p, child);
  assert.equal(currentStep(p, out)?.step.id, 'tail');
  assert.equal(out.stack.length, 1);
  assert.deepEqual(stepBack(out), child);
  assert.equal(stepOut(p, first).status, 'completed');
});

test('recursive calls are skipped instead of growing an infinite stack', () => {
  const p = fixture();
  p.canvases.leaf.routes[0].steps[0] = step('recurse', { childCanvasId: 'root', childRouteId: 'forward' });
  let state = createRunner(p, 'root', 'forward');
  state = stepInto(p, state);
  state = stepInto(p, state);
  state = stepInto(p, state);
  assert.equal(state.stack.length, 2);
  assert.equal(currentStep(p, state)?.step.id, 'child-tail');
});

test('missing child routes are skipped, never inferred from modules or first route', () => {
  for (const childRef of [
    { childCanvasId: 'child' },
    { childRouteId: 'forward' },
    { childCanvasId: 'missing', childRouteId: 'forward' },
    { childCanvasId: 'child', childRouteId: 'missing' },
    {},
  ]) {
    const p = fixture();
    p.canvases.root.modules.call = { elementId: 'call', childCanvasId: 'child', title: 'module' };
    p.canvases.root.routes[0].steps[0] = step('call', childRef);
    assert.equal(currentStep(p, stepInto(p, createRunner(p, 'root', 'forward')))?.step.id, 'tail');
  }
});

test('empty child route immediately resumes caller and last-child endings cascade', () => {
  const p = fixture();
  p.canvases.child.routes[0].steps = [];
  assert.equal(currentStep(p, stepInto(p, createRunner(p, 'root', 'forward')))?.step.id, 'tail');
  p.canvases.root.routes[0].steps.pop();
  p.canvases.child.routes[0].steps = [step('nested', { childCanvasId: 'leaf', childRouteId: 'detail' })];
  let state = createRunner(p, 'root', 'forward');
  state = stepInto(p, state);
  state = stepInto(p, state);
  assert.equal(stepInto(p, state).status, 'completed');
});

test('invalid initial references throw and invalid current frames have no step', () => {
  const p = fixture();
  assert.throws(() => createRunner(p, 'missing', 'forward'), /Unknown/);
  assert.throws(() => createRunner(p, 'root', 'missing'), /Unknown/);
  for (const index of [-1, NaN, 0.5, 999]) {
    const invalid = { status: 'paused' as const, stack: [{ canvasId: 'root', routeId: 'forward', index }], history: [] };
    assert.equal(currentStep(p, invalid), null);
    assert.equal(stepOver(p, invalid).status, 'completed');
  }
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

test('operations preserve frozen project, prior frames, history, and running status', () => {
  const p = deepFreeze(fixture());
  const initial = deepFreeze({ ...createRunner(p, 'root', 'forward'), status: 'running' as const });
  const original = JSON.stringify({ p, initial });
  const child = deepFreeze(stepInto(p, initial));
  assert.equal(child.status, 'running');
  const over = deepFreeze(stepOver(p, child));
  const out = deepFreeze(stepOut(p, over));
  assert.deepEqual(stepBack(child), initial);
  assert.deepEqual(stepBack(out), over);
  assert.equal(JSON.stringify({ p, initial }), original);
  assert.notEqual(child.history[0].stack[0], initial.stack[0]);
  assert.notEqual(child.stack[0], initial.stack[0]);
  const done = stepOut(p, initial);
  assert.deepEqual(stepInto(p, done), done);
  assert.deepEqual(stepOver(p, done), done);
  assert.deepEqual(stepOut(p, done), done);
  const idle = { status: 'idle' as const, stack: [], history: [] };
  assert.equal(currentStep(p, idle), null);
  assert.deepEqual(stepInto(p, idle), idle);
});

test('empty route starts completed without a current step', () => {
  const p = fixture();
  const state = createRunner(p, 'root', 'empty');
  assert.equal(state.status, 'completed');
  assert.equal(currentStep(p, state), null);
});
