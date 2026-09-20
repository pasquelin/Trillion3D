import { EngineError } from '../sdk-core/index.ts';

/** An existing canvas, or its literal document ID (without a selector prefix). */
export type ExplorerTarget = HTMLCanvasElement | string;

export function resolveExplorerTarget(target: ExplorerTarget): HTMLCanvasElement {
  let element: unknown = target;
  if (typeof target === 'string') {
    if (!target.length) throw new EngineError('INVALID_CANVAS', 'Canvas ID must not be empty');
    if (typeof document === 'undefined')
      throw new EngineError('CANVAS_DOCUMENT_UNAVAILABLE', 'Canvas ID lookup requires a document');
    element = document.getElementById(target);
    if (!element) throw new EngineError('CANVAS_NOT_FOUND', `No canvas with ID "${target}"`);
  }
  const canvas = element as HTMLCanvasElement | null;
  if (!canvas || canvas.nodeName !== 'CANVAS' || typeof canvas.getContext !== 'function')
    throw new EngineError('INVALID_CANVAS', 'Explorer target must be a canvas element or its ID');
  return canvas;
}
