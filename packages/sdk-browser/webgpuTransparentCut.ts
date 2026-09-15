import type * as THREE from 'three';
import { copyElements, sameElements } from './matrixElements.ts';
import { createSelectionResult, type PageRec } from './pageSelection.ts';

type Cache = { get(key: string): unknown };

/**
 * The transparent cut, held from one image to the next with the inputs it was cut from.
 *
 * No GPU readback describes the transparent clusters, so the CPU cuts their DAG itself — the one
 * traversal an image still owns. That traversal is a function of six things and nothing else: the
 * camera's view and projection, the error threshold the budget settled on, the viewport, the world
 * matrices of the scene, and what the page cache holds. The frame number it also receives only stamps
 * `seen` on the clusters it keeps, and nothing in the runtime reads `seen`.
 *
 * So an image whose six inputs are the ones the held cut was computed from would walk the same DAG to
 * the same answer: it reads the answer. Any of them moving — the camera by a hair, one page arriving
 * or being evicted, a node moved — re-sweeps the whole cut, and the sweep writes the same arrays the
 * held cut lives in, so the image downstream cannot tell the two cases apart. Nothing is remembered
 * across a change of cache either: the cache object itself is part of the key.
 */
export function createTransparentCutHold() {
  const shown: PageRec[] = [],
    wanted: PageRec[] = [];
  const result = createSelectionResult<PageRec>();
  const view = new Float64Array(16),
    projection = new Float64Array(16);
  let held = false,
    heldCache: Cache | undefined,
    heldPixelError = 0,
    heldWidth = 0,
    heldHeight = 0,
    heldEpoch = 0,
    heldResidency = 0;
  return {
    shown,
    wanted,
    result,
    /** Forgets the cut: the arrays it published no longer describe the image. */
    invalidate() {
      held = false;
      heldCache = undefined;
    },
    /** True when every input of the cut still reads as it did when the held cut was computed. */
    holds(
      camera: THREE.PerspectiveCamera,
      pixelError: number,
      viewport: readonly [number, number],
      epoch: number,
      cache: Cache,
      residency: number,
    ) {
      return (
        held &&
        heldCache === cache &&
        heldPixelError === pixelError &&
        heldWidth === viewport[0] &&
        heldHeight === viewport[1] &&
        heldEpoch === epoch &&
        heldResidency === residency &&
        sameElements(view, camera.matrixWorldInverse.elements) &&
        sameElements(projection, camera.projectionMatrix.elements)
      );
    },
    /** Records the inputs the cut now in `result` was computed from. */
    keep(
      camera: THREE.PerspectiveCamera,
      pixelError: number,
      viewport: readonly [number, number],
      epoch: number,
      cache: Cache,
      residency: number,
    ) {
      copyElements(view, camera.matrixWorldInverse.elements);
      copyElements(projection, camera.projectionMatrix.elements);
      heldCache = cache;
      heldPixelError = pixelError;
      heldWidth = viewport[0];
      heldHeight = viewport[1];
      heldEpoch = epoch;
      heldResidency = residency;
      held = true;
    },
  };
}

export type TransparentCutHold = ReturnType<typeof createTransparentCutHold>;
