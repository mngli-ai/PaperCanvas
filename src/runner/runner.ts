import type { Project, Route, Step } from '../shared/types.ts';

export interface Frame { canvasId: string; routeId: string; index: number }
export interface Snapshot { status: 'idle' | 'paused' | 'running' | 'completed'; stack: Frame[] }
export interface RunnerState extends Snapshot { history: Snapshot[] }

function routeFor(project: Project, frame: Frame): Route | undefined {
  return project.canvases[frame.canvasId]?.routes.find(route => route.id === frame.routeId);
}

export function createRunner(project: Project, canvasId: string, routeId: string): RunnerState {
  const frame = { canvasId, routeId, index: 0 };
  const route = routeFor(project, frame);
  if (!route) throw new Error(`Unknown canvas or route: ${canvasId}/${routeId}`);
  return { status: route.steps.length ? 'paused' : 'completed', stack: route.steps.length ? [frame] : [], history: [] };
}

function copyStack(stack: Frame[]): Frame[] {
  return stack.map(frame => ({ ...frame }));
}

function snapshot(state: Snapshot): Snapshot {
  return { status: state.status, stack: copyStack(state.stack) };
}

function transition(project: Project, state: RunnerState, kind: 'into' | 'over' | 'out'): RunnerState {
  if (state.status === 'idle' || state.status === 'completed') return state;
  const active = currentStep(project, state);
  const stack = copyStack(state.stack);
  const childFrame = active?.step.childCanvasId && active.step.childRouteId
    ? { canvasId: active.step.childCanvasId, routeId: active.step.childRouteId, index: 0 }
    : undefined;
  const canEnter = childFrame && routeFor(project, childFrame)
    && !stack.some(frame => frame.canvasId === childFrame.canvasId && frame.routeId === childFrame.routeId);
  if (!active || kind === 'out') {
    stack.pop();
    if (stack.length) stack[stack.length - 1].index += 1;
  } else if (kind === 'into' && canEnter) {
    stack.push(childFrame);
  } else if (stack.length) {
    stack[stack.length - 1].index += 1;
  }
  // Exhausted frames unwind in one operation, including a chain of last-child calls.
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const route = routeFor(project, frame);
    if (route && frame.index < route.steps.length) break;
    stack.pop();
    if (stack.length) stack[stack.length - 1].index += 1;
  }
  return { status: stack.length ? state.status : 'completed', stack, history: [...state.history.map(snapshot), snapshot(state)] };
}

export function stepInto(project: Project, state: RunnerState): RunnerState {
  return transition(project, state, 'into');
}

export function stepOver(project: Project, state: RunnerState): RunnerState {
  return transition(project, state, 'over');
}

export function stepOut(project: Project, state: RunnerState): RunnerState {
  return transition(project, state, 'out');
}

export function stepBack(state: RunnerState): RunnerState {
  const previous = state.history.at(-1);
  if (!previous) return state;
  return { ...snapshot(previous), history: state.history.slice(0, -1).map(snapshot) };
}

export function currentStep(project: Project, state: RunnerState): { canvasId: string; step: Step } | null {
  if (state.status === 'idle' || state.status === 'completed') return null;
  const frame = state.stack.at(-1);
  if (!frame || !Number.isInteger(frame.index) || frame.index < 0) return null;
  const step = routeFor(project, frame)?.steps[frame.index];
  return step ? { canvasId: frame.canvasId, step } : null;
}
