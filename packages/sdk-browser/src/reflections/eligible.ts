import type { PageSurface } from '../page/surface.ts';

/** Every lit physical surface has a specular lobe, including a fully rough dielectric. */
export const reflects = (surface: PageSurface) => surface.lit && (surface.model ?? 0) === 0;
