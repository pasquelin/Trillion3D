/**
 * The display graph the engine publishes with its transparent copies on it.
 *
 * The engine draws none of it: prepare takes a copy out again as soon as it has built its GPU
 * item, and the WebGPU engine presents its own surface — it declares no `drawHostGeometry`, so no
 * host renderer ever draws this graph. What a host still reads of it is the contract of
 * `HostScene`: the clear colour, the children and the walk. That is a record the engine owns, not
 * an object of a rendering library, and building it here is what keeps the transparent path free
 * of one. A witness that DOES draw its graph with a host renderer builds a host scene instead
 * (`hostSceneObjects.ts`).
 */

import { srgbToLinear } from '../sdk-core/index.ts';
import type { HostNode, HostScene } from './hostResources.ts';
import type { BlendCopy } from './blendCopyContract.ts';

/** The published scene, plus the two writes the engine makes on it: taking a copy back out when
 *  prepare has its GPU item, and emptying it when the backend is disposed. */
export type BlendHostScene = HostScene & { remove(node: unknown): void; clear(): void };

/** The clear colour in the linear components a host reads off a scene background, from the
 *  packed sRGB byte triple every engine receives it as. */
const linearBackground = (clearColor: number) => ({
  isColor: true,
  r: srgbToLinear(((clearColor >> 16) & 0xff) / 0xff),
  g: srgbToLinear(((clearColor >> 8) & 0xff) / 0xff),
  b: srgbToLinear((clearColor & 0xff) / 0xff),
});

export function createBlendScene(clearColor: number, copies: readonly BlendCopy[]): BlendHostScene {
  const children = [...copies] as unknown as HostNode[];
  return {
    name: 'web-geometry-transparent',
    visible: true,
    background: linearBackground(clearColor),
    children,
    traverse(visit: (node: HostNode) => void) {
      visit(this as unknown as HostNode);
      for (const child of children) visit(child);
    },
    remove(node: unknown) {
      const at = children.indexOf(node as HostNode);
      if (at >= 0) children.splice(at, 1);
    },
    clear() {
      children.length = 0;
    },
  };
}
