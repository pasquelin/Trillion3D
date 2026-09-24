/**
 * The display graph the engine publishes with its transparent copies on it.
 *
 * The engine draws none of it: prepare takes a copy out again as soon as it has built its GPU
 * item, and the WebGPU engine presents its own surface — it declares no `drawHostGeometry`, so no
 * host renderer ever draws this graph. What a host still reads of it is the contract of
 * `HostScene`: the clear colour, the children and the walk. That is a record the engine owns, not
 * an object of a rendering library, and building it here is what keeps the transparent path free
 * of one. A witness that DOES draw its graph with a host renderer builds a host scene instead
 * (`../host/scene/objects.ts`).
 */

import { srgbToLinear } from '../../../sdk-core/src/index.ts';
import { clearValueOf } from '../../../sdk-core/src/world/math/packedColour.ts';
import type { HostScene } from '../host/resources.ts';
import type { BlendCopy } from './blendCopyContract.ts';

/** The published scene, plus the two writes the engine makes on it: taking a copy back out when
 *  prepare has its GPU item, and emptying it when the backend is disposed. */
export type BlendHostScene = HostScene & {
  readonly name: string;
  readonly visible: boolean;
  remove(node: object): void;
  clear(): void;
};

/** The clear colour in the linear components a host reads off a scene background. The packed
 *  triple is taken apart where every other reader of it takes it apart (`sdk-core/world/math/packedColour.ts`); what
 *  is proper to a background is the conversion out of sRGB, which a clear value does not make. */
const linearBackground = (clearColor: number) => {
  const { r, g, b } = clearValueOf(clearColor);
  return { isColor: true, r: srgbToLinear(r), g: srgbToLinear(g), b: srgbToLinear(b) };
};

/** Writes a new clear colour on a published scene's background, in place: the record is kept. */
export function recolourBlendScene(scene: HostScene, clearColor: number) {
  Object.assign(scene.background as object, linearBackground(clearColor));
}

export function createBlendScene(clearColor: number, copies: readonly BlendCopy[]): BlendHostScene {
  const children = [...copies];
  const scene: BlendHostScene = {
    name: 'trillion3d-transparent',
    visible: true,
    background: linearBackground(clearColor),
    children,
    // The walk a host makes of a display graph: the node itself, then what hangs under it. A
    // transparent copy carries no subtree, so the list IS the walk.
    traverse: (visit: (node: object) => void) => {
      visit(scene);
      for (const child of children) visit(child);
    },
    remove: (node: object) => {
      const at = children.findIndex((child) => child === node);
      if (at >= 0) children.splice(at, 1);
    },
    clear: () => {
      children.length = 0;
    },
  };
  return scene;
}
