import type { SceneProxyDescriptor } from '../../contracts/proxy.ts';
import { invalidProxy } from './proxyError.ts';

/** Read the versioned ownership suffix, never infer owners from geometry or names. */
export function decodeProxyOwnership(d: SceneProxyDescriptor, buffer: ArrayBuffer, start: number) {
  let at = start;
  const take = (count: number) => {
    const data = new Uint32Array(buffer, at, count);
    at += count * 4;
    return data;
  };
  const triangleGroups = take(d.triangles);
  const groupOffsets = take(d.groups + 1);
  const owners = take(d.owners * 2);
  const sourceParents = new Int32Array(buffer, at, d.instances);
  at += d.instances * 4;
  // The preceding u32 columns need not leave doubles aligned to eight bytes.
  const bytes = new DataView(buffer);
  const bindWorlds = new Float64Array(d.instances * 16);
  for (let i = 0; i < bindWorlds.length; i++) bindWorlds[i] = bytes.getFloat64(at + i * 8, true);
  const refuse = (reason: string): never => {
    throw invalidProxy(`Invalid proxy ownership: ${reason}`, {});
  };
  if (groupOffsets[0] !== 0 || groupOffsets[d.groups] !== d.owners) refuse('group extent');
  for (let i = 0; i < d.groups; i++)
    if (groupOffsets[i] >= groupOffsets[i + 1]) refuse('empty or unordered owner group');
  for (const group of triangleGroups) if (group >= d.groups) refuse('triangle group');
  for (let i = 0; i < owners.length; i += 2) if (owners[i] >= d.instances) refuse('source node');
  const visited = new Uint8Array(d.instances);
  for (let node = 0; node < d.instances; node++) {
    let parent = node;
    while (parent !== -1 && visited[parent] !== 2) {
      if (parent < 0 || parent >= d.instances) refuse('source parent rank');
      if (visited[parent] === 1) refuse('source parent cycle');
      visited[parent] = 1;
      parent = sourceParents[parent];
    }
    parent = node;
    while (parent !== -1 && visited[parent] === 1) {
      visited[parent] = 2;
      parent = sourceParents[parent];
    }
  }
  for (const value of bindWorlds) if (!Number.isFinite(value)) refuse('non-finite bind matrix');
  return { triangleGroups, groupOffsets, owners, bindWorlds, sourceParents };
}
