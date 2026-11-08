import type { Canvas, Project } from '../shared/types.ts';
import { demoCanvases } from './demo.ts';

export function createDemoProject(): Project {
  const project = createProject();
  project.title = 'DiT architecture · illustrative demo';
  project.canvases = demoCanvases();
  assertValid(project);
  return project;
}

function emptyCanvas(id: string, title: string): Canvas {
  return { id, title, elements: [], files: {}, appState: {}, modules: {}, routes: [] };
}

const record = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const own = (obj: object, key: string) => Object.hasOwn(obj, key);
// Excalidraw 0.18 element types (tools such as eraser/hand are not elements).
const elementTypes = new Set([
  'selection', 'rectangle', 'diamond', 'ellipse', 'text', 'line', 'arrow',
  'freedraw', 'image', 'frame', 'magicframe', 'iframe', 'embeddable',
]);

const fileMimeTypes = new Set([
  'image/svg+xml', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'image/bmp', 'image/x-icon', 'image/avif', 'image/jfif', 'application/octet-stream',
]);

/** Validate structure first, then references; malformed imported JSON never crashes validation. */
export function validateProject(project: Project): string[] {
  const errors: string[] = [];
  const p: any = project;
  if (!record(p)) return ['Project must be an object'];
  if (p.schemaVersion !== 1) errors.push('Unsupported schemaVersion');
  for (const key of ['id', 'title', 'rootCanvasId']) if (!text(p[key])) errors.push(`Invalid ${key}`);
  if (!Number.isSafeInteger(p.revision) || p.revision < 0) errors.push('Invalid revision');
  if (!record(p.canvases)) return [...errors, 'canvases must be an object'];
  if (!own(p.canvases, p.rootCanvasId)) errors.push('Missing root canvas');
  const edges = new Map<string, string[]>();
  for (const [id, c] of Object.entries(p.canvases) as [string, any][]) {
    if (!record(c)) { errors.push(`Canvas ${id} must be an object`); continue; }
    if (c.id !== id || !text(c.id)) errors.push(`Canvas ${id} id mismatch`);
    if (!text(c.title)) errors.push(`Canvas ${id} title is invalid`);
    if (!record(c.files) || !record(c.appState)) errors.push(`Canvas ${id} files/appState must be objects`);
    if (record(c.files)) for (const [key, file] of Object.entries(c.files)) {
      if (!record(file)) { errors.push(`Canvas ${id} invalid file ${key}`); continue; }
      if (!text(key) || file.id !== key) errors.push(`Canvas ${id} file ${key} id mismatch`);
      if (!fileMimeTypes.has(file.mimeType)) errors.push(`Canvas ${id} file ${key} has an invalid mimeType`);
      // Accept both base64 and URL-encoded data (e.g. SVG), not remote URLs.
      if (typeof file.dataURL !== 'string' || !/^data:[^,]*,[\s\S]+$/i.test(file.dataURL)) errors.push(`Canvas ${id} file ${key} has an invalid dataURL`);
      if (!Number.isFinite(file.created)) errors.push(`Canvas ${id} file ${key} has an invalid created timestamp`);
      for (const optional of ['lastRetrieved', 'version']) {
        if (file[optional] !== undefined && !Number.isFinite(file[optional])) errors.push(`Canvas ${id} file ${key} has an invalid ${optional}`);
      }
    }
    const elementIds = new Set<string>();
    if (!Array.isArray(c.elements)) errors.push(`Canvas ${id} elements must be an array`);
    else for (const e of c.elements) {
      if (!record(e) || !text(e.id)) { errors.push(`Canvas ${id} element requires an id`); continue; }
      if (elementIds.has(e.id)) errors.push(`Canvas ${id} duplicate element ${e.id}`);
      elementIds.add(e.id);
      if (!elementTypes.has(e.type)) errors.push(`Canvas ${id} element ${e.id} has an invalid type`);
      for (const key of ['x', 'y', 'width', 'height']) {
        if (!Number.isFinite(e[key]) || ((key === 'width' || key === 'height') && e[key] < 0)) errors.push(`Canvas ${id} element ${e.id} has an invalid ${key}`);
      }
    }
    const children: string[] = [];
    const target = (child: unknown) => {
      if (!text(child) || !own(p.canvases, child)) errors.push(`Canvas ${id} missing child ${String(child)}`);
      else children.push(child);
    };
    if (!record(c.modules)) errors.push(`Canvas ${id} modules must be an object`);
    else for (const [key, m] of Object.entries(c.modules) as [string, any][]) {
      if (!record(m)) { errors.push(`Canvas ${id} invalid module ${key}`); continue; }
      if (key !== m.elementId || !elementIds.has(key)) errors.push(`Canvas ${id} module element ${key} is missing or mismatched`);
      if (!text(m.title)) errors.push(`Canvas ${id} module title is invalid`);
      for (const optional of ['latex', 'source']) if (m[optional] !== undefined && typeof m[optional] !== 'string') errors.push(`Invalid module ${optional}`);
      target(m.childCanvasId);
    }
    if (!Array.isArray(c.routes)) errors.push(`Canvas ${id} routes must be an array`);
    else {
      const routeIds = new Set<string>();
      for (const r of c.routes) {
        if (!record(r)) { errors.push(`Canvas ${id} invalid route`); continue; }
        if (!text(r.id) || routeIds.has(r.id)) errors.push(`Canvas ${id} invalid or duplicate route id`);
        routeIds.add(r.id);
        if (!text(r.name) || !text(r.color)) errors.push(`Canvas ${id} invalid route name/color`);
        if (!Array.isArray(r.steps)) { errors.push(`Route ${r.id} steps must be an array`); continue; }
        const stepIds = new Set<string>();
        for (const s of r.steps) {
          if (!record(s)) { errors.push(`Route ${r.id} invalid step`); continue; }
          if (!text(s.id) || stepIds.has(s.id)) errors.push(`Route ${r.id} invalid or duplicate step id`);
          stepIds.add(s.id);
          if (!elementIds.has(s.elementId)) errors.push(`Route ${r.id} missing element ${s.elementId}`);
          if (typeof s.label !== 'string') errors.push(`Route ${r.id} invalid step label`);
          if (s.childCanvasId !== undefined) target(s.childCanvasId);
          if (s.childRouteId !== undefined) {
            const child = p.canvases[s.childCanvasId];
            if (!text(s.childRouteId) || !record(child) || !Array.isArray(child.routes) || !child.routes.some((cr: any) => record(cr) && cr.id === s.childRouteId)) errors.push(`Route ${r.id} missing child route ${s.childRouteId}`);
          }
        }
      }
    }
    edges.set(id, children);
  }
  const active = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) { errors.push(`Child canvas cycle at ${id}`); return; }
    if (done.has(id)) return;
    active.add(id);
    for (const child of edges.get(id) ?? []) visit(child);
    active.delete(id); done.add(id);
  };
  for (const id of edges.keys()) visit(id);
  return errors;
}

function assertValid(project: Project): void {
  const errors = validateProject(project);
  if (errors.length) throw new Error(`Invalid project: ${errors.join('; ')}`);
}

export function parseProject(value: string): Project {
  let project: Project;
  try { project = JSON.parse(value); }
  catch { throw new Error('Invalid project: malformed JSON'); }
  assertValid(project);
  return project;
}

export function serializeProject(project: Project): string {
  assertValid(project);
  return JSON.stringify(project, null, 2);
}

export function addChildCanvas(project: Project, parentCanvasId: string, elementId: string, title: string): Project {
  assertValid(project);
  const parent = own(project.canvases, parentCanvasId) ? project.canvases[parentCanvasId] : undefined;
  if (!parent) throw new Error(`Missing parent canvas ${parentCanvasId}`);
  if (!parent.elements.some(e => record(e) && e.id === elementId && !e.isDeleted)) throw new Error(`Missing element ${elementId}`);
  if (own(parent.modules, elementId)) throw new Error(`Element ${elementId} already has a child canvas`);
  if (!text(title)) throw new Error('Child canvas title is required');
  const next = structuredClone(project);
  const id = crypto.randomUUID();
  next.canvases[id] = emptyCanvas(id, title);
  Object.defineProperty(next.canvases[parentCanvasId].modules, elementId, {
    value: { elementId, childCanvasId: id, title }, enumerable: true, writable: true, configurable: true,
  });
  next.revision++;
  assertValid(next);
  return next;
}

export function updateCanvas(project: Project, canvas: Canvas): Project {
  assertValid(project);
  if (!canvas || !own(project.canvases, canvas.id)) throw new Error(`Missing canvas ${canvas?.id}`);
  const next = structuredClone(project);
  next.canvases[canvas.id] = structuredClone(canvas);
  next.revision++;
  assertValid(next);
  return next;
}

export function createProject(): Project {
  return {
    schemaVersion: 1, id: crypto.randomUUID(), title: 'Untitled paper',
    rootCanvasId: 'root', revision: 0,
    canvases: { root: emptyCanvas('root', 'Overview') },
  };
}
