import { readdirSync } from 'node:fs';

/** Captures present in the static thumbnail folder when the portal is built. */
export const EXAMPLE_THUMBNAILS = readdirSync(
  new URL('../../assets/examples/thumbnails/', import.meta.url),
)
  .filter((file) => file.endsWith('.png'))
  .map((file) => file.slice(0, -4));
