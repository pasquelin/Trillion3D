import assert from 'node:assert/strict';
import test from 'node:test';
import { draw } from '../site/lessons/draw.ts';
import { evaluate } from '../site/lessons/evaluate.ts';
import { initialState } from '../site/lessons/scenarios.ts';

class SvgNode {
  children = [];
  setAttribute(name, value) {
    assert.doesNotMatch(String(value), /NaN|undefined/, name);
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.children = children;
  }
}

test('all four advanced lessons mount their complementary diagram with finite geometry', () => {
  const previous = globalThis.document;
  globalThis.document = { createElementNS: () => new SvgNode() };
  try {
    for (const id of [
      'matrix-inverse',
      'reflection-orientation',
      'quaternion-turn',
      'normal-transform',
    ]) {
      const svg = new SvgNode();
      draw(svg, evaluate(id, initialState(id), 'fr'), 'fr');
      assert.ok(svg.children.length > 3, id);
    }
  } finally {
    globalThis.document = previous;
  }
});
