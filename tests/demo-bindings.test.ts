import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import katex from 'katex';
import { demoCanvases } from '../src/domain/demo.ts';
import { createDemoProject, parseProject, serializeProject, validateProject } from '../src/domain/project.ts';

type Element = Record<string, any>;

// Read the shipped package, not a guessed font index or an app-owned constant.
const packageDir = new URL('../node_modules/@excalidraw/excalidraw/dist/dev/', import.meta.url);
const chunks = readdirSync(packageDir).filter(name => name.endsWith('.js')).map(name => readFileSync(new URL(name, packageDir), 'utf8')).join('\n');
const fontIndex = Number(chunks.match(/Excalifont:\s*(\d+)/)?.[1]);
const artistRoughness = Number(chunks.match(/var ROUGHNESS = \{\s*architect: 0,\s*artist: (\d+)/)?.[1]);

test('demo defaults match installed Excalifont and middle roughness', () => {
  assert.equal(fontIndex, 5);
  assert.equal(artistRoughness, 1);
  for (const canvas of Object.values(demoCanvases())) {
    assert.equal(canvas.appState.currentItemFontFamily, fontIndex);
    assert.equal(canvas.appState.currentItemRoughness, artistRoughness);
    for (const e of canvas.elements as Element[]) {
      assert.equal(e.roughness, artistRoughness, e.id);
      if (e.type === 'text') assert.equal(e.fontFamily, fontIndex, e.id);
    }
  }
});

test('every module label is a reciprocally bound, geometrically centered text element', () => {
  for (const canvas of Object.values(demoCanvases())) {
    const elements = canvas.elements as Element[];
    const rectangles = elements.filter(e => e.type === 'rectangle');
    assert.equal(rectangles.length, 4);
    for (const box of rectangles) {
      const label = elements.find(e => e.id === `${box.id}-label`)!;
      assert.equal(label.containerId, box.id);
      assert.equal(label.textAlign, 'center');
      assert.equal(label.verticalAlign, 'middle');
      assert.equal(label.x + label.width / 2, box.x + box.width / 2);
      assert.equal(label.y + label.height / 2, box.y + box.height / 2);
      assert.deepEqual(box.boundElements.filter((ref: Element) => ref.type === 'text'), [{ id: label.id, type: 'text' }]);
    }
  }
});

test('arrows bind both neighboring boxes with reciprocal references and correct gaps', () => {
  for (const canvas of Object.values(demoCanvases())) {
    const elements = canvas.elements as Element[];
    const boxes = elements.filter(e => e.type === 'rectangle');
    const arrows = elements.filter(e => e.type === 'arrow');
    assert.equal(arrows.length, boxes.length - 1);
    arrows.forEach((arrow, i) => {
      const source = boxes[i], target = boxes[i + 1];
      assert.equal(arrow.startBinding.elementId, source.id);
      assert.equal(arrow.endBinding.elementId, target.id);
      for (const [binding, box] of [[arrow.startBinding, source], [arrow.endBinding, target]]) {
        assert.equal(binding.focus, 0);
        assert.equal(binding.gap, 10);
        assert.ok(box.boundElements.some((ref: Element) => ref.id === arrow.id && ref.type === 'arrow'));
      }
      const [start, end] = arrow.points;
      assert.equal(arrow.x + start[0], source.x + source.width + arrow.startBinding.gap);
      assert.equal(arrow.x + end[0], target.x - arrow.endBinding.gap);
      assert.equal(arrow.y + start[1], source.y + source.height / 2);
      assert.equal(arrow.y + end[1], target.y + target.height / 2);
    });
    for (const box of boxes) for (const ref of box.boundElements.filter((r: Element) => r.type === 'arrow')) {
      const arrow = arrows.find(a => a.id === ref.id)!;
      assert.ok(arrow.startBinding.elementId === box.id || arrow.endBinding.elementId === box.id);
    }
  }
});

test('attention math is rendered image data with editable valid LaTeX, not Unicode imitation', () => {
  const canvas = demoCanvases().attention;
  const elements = canvas.elements as Element[];
  const formulas = elements.filter(e => e.customData?.paperCanvas?.latex);
  assert.equal(formulas.length, 2);
  assert.deepEqual(formulas.map(e => e.customData.paperCanvas.latex), [String.raw`\frac{QK^{\mathsf{T}}}{\sqrt{d_k}}`, String.raw`\operatorname{softmax}\!\left(\frac{QK^{\mathsf{T}}}{\sqrt{d_k}}\right)V`]);
  for (const e of formulas) {
    assert.equal(e.type, 'image');
    assert.equal(e.status, 'saved');
    assert.ok(e.width > 0 && e.height > 0);
    assert.doesNotThrow(() => katex.renderToString(e.customData.paperCanvas.latex, { throwOnError: true }));
    const file = canvas.files[e.fileId] as Element;
    assert.equal(file.id, e.fileId);
    assert.equal(file.mimeType, 'image/png');
    assert.match(file.dataURL, /^data:image\/png;base64,/);
    const bytes = Buffer.from(file.dataURL.split(',')[1], 'base64');
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.ok(bytes.length > 1000, 'real rendered asset, not an empty placeholder');
    assert.equal(bytes.readUInt32BE(16), e.width * 2);
    assert.equal(bytes.readUInt32BE(20), e.height * 2);
  }
  assert.ok(!elements.some(e => e.type === 'text' && /QKᵀ|√d|Softmax × V/.test(e.text)));
});

test('bound demo, formula assets and existing routes survive project round trip', () => {
  const project = createDemoProject();
  assert.deepEqual(validateProject(project), []);
  assert.deepEqual(parseProject(serializeProject(project)), project);
  assert.equal(project.canvases.root.modules['dit-block'].childCanvasId, 'dit');
  assert.equal(project.canvases.dit.modules['attention-block'].childCanvasId, 'attention');
  for (const canvas of Object.values(project.canvases)) {
    assert.equal(canvas.routes[0].id, 'forward');
    assert.equal(canvas.routes[0].steps.length, 4);
  }
});
