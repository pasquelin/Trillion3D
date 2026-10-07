/**
 * Which source images the prepared scene must read. The engine reads the levels the compiler
 * baked, so `'cache'` by default; a host that asked for `'host'` is obeyed. Without
 * `createImageBitmap` no level can be read at all (`createTextureLevelReader`), and the images
 * are the only source there is.
 */
export function resolveTextureSource(asked: 'host' | 'cache' | undefined): 'host' | 'cache' {
  if (typeof createImageBitmap !== 'function') return 'host'
  return asked ?? 'cache'
}
