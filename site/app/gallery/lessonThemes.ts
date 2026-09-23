import type { CatalogExample } from '../../content/catalog.ts';

/** The lesson themes, in tab order; each is named by `themes.<id>` in the dictionaries. */
export const THEMES = [
  'transforms',
  'geometry',
  'camera',
  'materials',
  'lighting',
  'performance',
] as const;
type Theme = (typeof THEMES)[number];

const byCategory: Record<string, Theme> = {
  transforms: 'transforms',
  vectors: 'geometry',
  geometry: 'geometry',
  bounds: 'geometry',
  camera: 'camera',
  scene: 'transforms',
  color: 'materials',
  streaming: 'performance',
  lighting: 'lighting',
};

export function themeOf(entry: Pick<CatalogExample, 'category'>): Theme {
  return byCategory[entry.category] ?? 'geometry';
}
