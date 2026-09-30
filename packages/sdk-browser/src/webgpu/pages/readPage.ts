import { readGeometryPageHeader } from '../../page/decode/geometryPageHeader.ts';
import type { WebgpuPagesCore } from './runtime.ts';

/**
 * The bytes one pool slot holds for a cluster: its quantized geometry page, read from the host's
 * page reader at the address the manifest gives it, or — for a cache that carries no geometry page
 * — the index page the arrival already left in memory. The slot is written from one of the two,
 * never from both, at the admission's `priority`.
 */
export function createPageSource(rt: WebgpuPagesCore) {
  const { context, setup } = rt,
    { sourceBytes, geometryUrls } = setup;
  const read = async (key: string, _signal?: AbortSignal, priority?: number) => {
    const geometryUrl = geometryUrls.get(key);
    if (geometryUrl === undefined)
      return sourceBytes.get(key) ?? Promise.reject(new Error('Missing page'));
    if (!context.readGeometryPage) throw new Error('Missing geometry page reader');
    const bytes = await context.readGeometryPage(geometryUrl, undefined, priority);
    // The pool uploads these words as they are and the shaders decode them in place, so nothing
    // downstream would ever notice a forged or truncated page. The format's own gate is read
    // here, once per admission: magic, version, grids, and counts that measure exactly this many
    // bytes. A page that fails it is refused through the loader's error path, never uploaded.
    readGeometryPageHeader(bytes);
    return bytes;
  };
  return { read };
}
