import { EngineError } from '../../../sdk-core/index.ts';
import { resolveExplorerTarget } from '../../explorerTarget.ts';

/** A canvas, an element to draw inside, or the literal document ID of either (no selector prefix). */
export type WorldTarget = HTMLCanvasElement | HTMLElement | string;

/**
 * The canvas a world draws on: the target itself when it is one — `resolveExplorerTarget` checks
 * it —, or a canvas made to fill the element it names.
 */
export function resolveWorldTarget(target: WorldTarget): HTMLCanvasElement {
  const element =
    typeof target === 'string' && typeof document !== 'undefined'
      ? document.getElementById(target)
      : target;
  if (!element || typeof element === 'string' || element.nodeName === 'CANVAS')
    return resolveExplorerTarget(target as HTMLCanvasElement | string);
  if (typeof element.appendChild !== 'function' || !element.ownerDocument)
    throw new EngineError('INVALID_CANVAS', 'World target must be an element, a canvas or its ID');
  const canvas = element.ownerDocument.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  element.appendChild(canvas);
  return canvas;
}
