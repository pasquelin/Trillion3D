// Shared SVG double and assertion for the four advanced lessons' diagrams:
// docs-gallery-diagram.test.ts and docs-gallery.test.ts both prove the same finite-geometry
// contract, so the fixture lives once here instead of twice.
import assert from 'node:assert/strict';
import { draw } from '../site/lessons/draw.ts';
import { evaluate } from '../site/lessons/evaluate.ts';
import { initialState } from '../site/lessons/scenarios.ts';

// The small slice of SVGSVGElement that draw.ts actually calls on the root element it is given.
type SvgHost = Pick<SVGSVGElement, 'setAttribute' | 'append' | 'replaceChildren'>;

class SvgNode {
  children: unknown[] = [];
  setAttribute(name: string, value: string) {
    assert.doesNotMatch(String(value), /NaN|undefined/, name);
  }
  append(...children: unknown[]) {
    this.children.push(...children);
  }
  replaceChildren(...children: unknown[]) {
    this.children = children;
  }
}

const ADVANCED_LESSON_IDS = [
  'matrix-inverse',
  'reflection-orientation',
  'quaternion-turn',
  'normal-transform',
] as const;

/** Mounts each advanced lesson's complementary SVG diagram against a document double and checks
 * every drawn node lands with finite geometry (no `NaN`/`undefined` attribute). */
export function assertAdvancedDiagramsMountFiniteGeometry() {
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    value: { createElementNS: () => new SvgNode() },
    configurable: true,
  });
  try {
    for (const id of ADVANCED_LESSON_IDS) {
      const svg = new SvgNode();
      draw((svg as SvgHost) as SVGSVGElement, evaluate(id, initialState(id), 'fr'), 'fr');
      assert.ok(svg.children.length > 3, id);
    }
  } finally {
    Object.defineProperty(globalThis, 'document', {
      value: previousDocument,
      configurable: true,
    });
  }
}
