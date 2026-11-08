import type { Canvas, Project } from '../shared/types.ts';
import { createProject, validateProject } from './project.ts';

type IdMap = Map<string, string>;
type Point = { x: number; y: number };
const record = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);

function assertValid(project: Project): void {
  const errors = validateProject(project);
  if (errors.length) throw new Error(`Invalid project: ${errors.join('; ')}`);
}

/** A scene is a single canvas, not a library or a PaperCanvas project. */
export function sceneAsProject(input: unknown, title = 'Imported scene'): Project {
  let scene: unknown = input;
  if (typeof scene === 'string') {
    try { scene = JSON.parse(scene); }
    catch { throw new Error('Invalid Excalidraw scene: malformed JSON'); }
  }
  if (!record(scene) || scene.type !== 'excalidraw' || !Array.isArray(scene.elements)) {
    throw new Error('Invalid Excalidraw scene');
  }
  const project = createProject();
  project.title = title;
  const canvas = project.canvases[project.rootCanvasId];
  canvas.title = title;
  canvas.elements = structuredClone(scene.elements);
  canvas.files = structuredClone(scene.files === undefined ? {} : scene.files);
  canvas.appState = structuredClone(scene.appState === undefined ? {} : scene.appState);
  assertValid(project);
  return project;
}

/**
 * Import all source canvases (including unlinked canvases) as an independent hierarchy.
 * point is the CENTER of the new parent module. Source canvas geometry is never moved.
 * Returns the new project; the new module link identifies the imported root canvas.
 */
export function importProjectAsModule(
  target: Project, targetCanvasId: string, sourceProject: Project, point: Point, title = sourceProject?.title,
): Project {
  assertValid(target);
  assertValid(sourceProject);
  if (!Object.hasOwn(target.canvases, targetCanvasId)) throw new Error(`Missing target canvas ${targetCanvasId}`);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Import point must be finite');
  if (typeof title !== 'string' || !title.trim()) throw new Error('Module title is required');

  // Reserve existing IDs across both projects, including IDs in Excalidraw metadata.
  const reserved = new Set<string>();
  const reserve = (value: unknown): void => {
    if (typeof value === 'string') reserved.add(value);
    else if (Array.isArray(value)) value.forEach(reserve);
    else if (record(value)) for (const [key, child] of Object.entries(value)) { reserved.add(key); reserve(child); }
  };
  reserve(target); reserve(sourceProject);
  const fresh = (): string => {
    let id: string;
    do { id = crypto.randomUUID(); } while (reserved.has(id));
    reserved.add(id);
    return id;
  };
  const mapped = (map: IdMap, id: string): string => {
    if (!map.has(id)) map.set(id, fresh());
    return map.get(id)!;
  };
  const canvasIds: IdMap = new Map();
  const scopes = new Map<string, { elements: IdMap; groups: IdMap; files: IdMap; routes: IdMap }>();
  for (const canvas of Object.values(sourceProject.canvases)) {
    mapped(canvasIds, canvas.id);
    const scope = { elements: new Map<string, string>(), groups: new Map<string, string>(), files: new Map<string, string>(), routes: new Map<string, string>() };
    scopes.set(canvas.id, scope);
    for (const element of canvas.elements as Record<string, any>[]) mapped(scope.elements, element.id);
    for (const id of Object.keys(canvas.files)) mapped(scope.files, id);
    for (const route of canvas.routes) mapped(scope.routes, route.id);
  }

  const next = structuredClone(target);
  for (const source of Object.values(sourceProject.canvases)) {
    const scope = scopes.get(source.id)!;
    const canvas: Canvas = structuredClone(source);
    canvas.id = canvasIds.get(source.id)!;
    // Rewrite only reference-bearing fields, never arbitrary strings/text/LaTeX/source.
    const refs = (value: any): any => {
      if (Array.isArray(value)) return value.map(refs);
      if (!record(value)) return value;
      return Object.fromEntries(Object.entries(value).map(([key, child]) => {
        if (typeof child === 'string') {
          if (['elementId', 'containerId', 'frameId', 'startBoundElementId', 'endBoundElementId'].includes(key)) return [key, mapped(scope.elements, child)];
          if (key === 'fileId') return [key, mapped(scope.files, child)];
          if (key === 'editingGroupId') return [key, mapped(scope.groups, child)];
        }
        if (key === 'groupIds' && Array.isArray(child)) return [key, child.map(id => typeof id === 'string' ? mapped(scope.groups, id) : id)];
        if (key === 'boundElements' && Array.isArray(child)) return [key, child.map(bound => record(bound) && typeof bound.id === 'string' ? { ...bound, id: mapped(scope.elements, bound.id) } : bound)];
        if (['selectedElementIds', 'previousSelectedElementIds', 'selectedGroupIds'].includes(key) && record(child)) {
          const map = key === 'selectedGroupIds' ? scope.groups : scope.elements;
          return [key, Object.fromEntries(Object.entries(child).map(([id, selected]) => [mapped(map, id), selected]))];
        }
        // Custom data is user-owned (not Excalidraw references), notably formula source.
        return [key, key === 'customData' ? child : refs(child)];
      }));
    };
    canvas.elements = canvas.elements.map(value => {
      const element = value as Record<string, any>;
      return { ...refs(element), id: mapped(scope.elements, element.id) };
    });
    canvas.files = Object.fromEntries(Object.entries(canvas.files).map(([id, file]) => {
      const newId = mapped(scope.files, id);
      return [newId, { ...(file as object), id: newId }];
    }));
    canvas.appState = refs(canvas.appState);
    canvas.modules = Object.fromEntries(Object.entries(canvas.modules).map(([id, module]) => {
      const elementId = mapped(scope.elements, id);
      return [elementId, { ...module, elementId, childCanvasId: canvasIds.get(module.childCanvasId)! }];
    }));
    canvas.routes = canvas.routes.map(route => ({
      ...route, id: mapped(scope.routes, route.id), steps: route.steps.map(step => ({
        ...step, id: fresh(), elementId: mapped(scope.elements, step.elementId),
        ...(step.childCanvasId !== undefined ? { childCanvasId: canvasIds.get(step.childCanvasId)! } : {}),
        ...(step.childRouteId !== undefined ? { childRouteId: mapped(scopes.get(step.childCanvasId!)!.routes, step.childRouteId) } : {}),
      })),
    }));
    next.canvases[canvas.id] = canvas;
  }

  const elementId = fresh(), textId = fresh();
  const lines = title.split('\n');
  const fontSize = 20, lineHeight = 1.25;
  const textWidth = Math.max(40, ...lines.map(line => Array.from(line).length * fontSize));
  const textHeight = lines.length * fontSize * lineHeight;
  const width = Math.max(240, textWidth + 40), height = Math.max(100, textHeight + 40);
  const base = {
    angle: 0, strokeColor: '#334155', backgroundColor: 'transparent', fillStyle: 'solid',
    strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null,
    roundness: null, seed: 17, version: 1, versionNonce: 1, isDeleted: false,
    updated: Date.now(), link: null, locked: false,
  };
  const parent = next.canvases[targetCanvasId];
  parent.elements.push({
    ...base, id: elementId, type: 'rectangle', x: point.x - width / 2, y: point.y - height / 2,
    width, height, backgroundColor: '#e0f2fe', roundness: { type: 3 }, boundElements: [{ id: textId, type: 'text' }],
  }, {
    ...base, id: textId, type: 'text', x: point.x - textWidth / 2, y: point.y - textHeight / 2,
    width: textWidth, height: textHeight, text: title, originalText: title,
    fontSize, fontFamily: 5, textAlign: 'center', verticalAlign: 'middle', containerId: elementId,
    autoResize: true, lineHeight, boundElements: null,
  });
  parent.modules[elementId] = { elementId, childCanvasId: canvasIds.get(sourceProject.rootCanvasId)!, title };
  next.revision++;
  assertValid(next);
  return next;
}
