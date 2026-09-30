/** Reads exactly the resources and ranges supplied to createBindGroup, into reused storage. */
export function entriesIdentity(entries: readonly GPUBindGroupEntry[], next: unknown[], at = 0) {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i],
      resource = entry.resource;
    next[at++] = entry.binding;
    if (resource && 'buffer' in resource) {
      next[at++] = resource.buffer;
      next[at++] = resource.offset ?? 0;
      next[at++] = resource.size;
    } else next[at++] = resource;
  }
  return at;
}
