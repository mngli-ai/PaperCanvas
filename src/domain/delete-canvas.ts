import type { Project } from '../shared/types.ts';
import { validateProject } from './project.ts';

function assertValid(project: Project): void {
  const errors = validateProject(project);
  if (errors.length) throw new Error(`Invalid project: ${errors.join('; ')}`);
}

/** Includes module edges and route-only calls, including detached hierarchies. */
function children(project: Project, id: string): string[] {
  const canvas = project.canvases[id];
  return [...Object.values(canvas.modules).map(link => link.childCanvasId),
    ...canvas.routes.flatMap(route => route.steps.flatMap(step => step.childCanvasId === undefined ? [] : [step.childCanvasId]))];
}

export function deletionPlan(project: Project, id: string): Set<string> {
  assertValid(project);
  if (id === project.rootCanvasId) throw new Error('Cannot delete root canvas');
  if (!Object.hasOwn(project.canvases, id)) throw new Error(`Missing canvas ${id}`);
  const removed = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const current = pending.pop()!;
    if (removed.has(current)) continue;
    removed.add(current);
    pending.push(...children(project, current));
  }
  // Any reference from outside the candidate branch makes that subtree shared.
  // The explicitly requested target is deleted even if it has several parents.
  const retained: string[] = [];
  for (const canvasId of Object.keys(project.canvases)) {
    if (!removed.has(canvasId)) retained.push(...children(project, canvasId));
  }
  while (retained.length) {
    const current = retained.pop()!;
    if (current === id || !removed.delete(current)) continue;
    retained.push(...children(project, current));
  }
  return removed;
}

export function deleteCanvas(project: Project, id: string): Project {
  const removed = deletionPlan(project, id);
  const next = structuredClone(project);
  for (const canvasId of removed) delete next.canvases[canvasId];
  for (const canvas of Object.values(next.canvases)) {
    const dead = new Set<string>();
    for (const [key, link] of Object.entries(canvas.modules)) {
      if (!removed.has(link.childCanvasId)) continue;
      dead.add(link.elementId);
      delete canvas.modules[key];
    }
    const elements = canvas.elements as Record<string, any>[];
    // Delete incident arrows rather than leave newly dangling arrows. Bound
    // labels can be represented by containerId, boundElements, or both.
    let changed = true;
    while (changed) {
      changed = false;
      const labels = new Set(elements.filter(e => dead.has(e.id)).flatMap(e =>
        (e.boundElements ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.id)));
      for (const e of elements) {
        if (dead.has(e.id)) continue;
        if ((e.type === 'text' && (dead.has(e.containerId) || labels.has(e.id))) ||
            (e.type === 'arrow' && (dead.has(e.startBinding?.elementId) || dead.has(e.endBinding?.elementId)))) {
          dead.add(e.id);
          changed = true;
        }
      }
    }
    for (const e of elements) {
      let edited = false;
      if (dead.has(e.id)) {
        e.isDeleted = true;
        e.boundElements = [];
        if ('containerId' in e) e.containerId = null;
        if ('startBinding' in e) e.startBinding = null;
        if ('endBinding' in e) e.endBinding = null;
        edited = true;
      } else {
        if (Array.isArray(e.boundElements)) {
          const bindings = e.boundElements.filter((b: any) => !dead.has(b.id));
          if (bindings.length !== e.boundElements.length) { e.boundElements = bindings; edited = true; }
        }
        if (dead.has(e.frameId)) { e.frameId = null; edited = true; }
      }
      if (edited) {
        e.version = (Number.isSafeInteger(e.version) ? e.version : 0) + 1;
        e.versionNonce = ((Number.isSafeInteger(e.versionNonce) ? e.versionNonce : 0) + 1) % 2147483647;
      }
    }
    const deletedElements = new Set(elements.filter(e => e.isDeleted).map(e => e.id));
    for (const route of canvas.routes) {
      route.steps = route.steps.filter(step => !deletedElements.has(step.elementId)).map(step => {
        if (step.childCanvasId !== undefined && removed.has(step.childCanvasId)) {
          delete step.childCanvasId;
          delete step.childRouteId;
        }
        return step;
      });
    }
    if (canvas.appState.selectedElementIds && typeof canvas.appState.selectedElementIds === 'object') {
      canvas.appState.selectedElementIds = Object.fromEntries(Object.entries(canvas.appState.selectedElementIds).filter(([id]) => !deletedElements.has(id)));
    }
  }
  next.revision++;
  assertValid(next);
  return next;
}
