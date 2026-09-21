import type { Locale } from '../../content/locale.ts';
import type { CatalogExample } from '../../content/catalog.ts';

export const themes: [string, string, string][] = [
  ['transforms', 'Transforms', 'Transformations'],
  ['geometry', 'Geometry and bounds', 'Géométrie et volumes'],
  ['camera', 'Camera', 'Caméra'],
  ['materials', 'Materials and textures', 'Matériaux et textures'],
  ['lighting', 'Lights and shadows', 'Lumières et ombres'],
  ['performance', 'Performance and streaming', 'Performance et streaming'],
];

const byCategory: Record<string, string> = {
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

export function themeOf(entry: Pick<CatalogExample, 'category'>): string {
  return byCategory[entry.category] ?? 'geometry';
}

export function themeLabel(id: string, locale: Locale): string {
  const theme = themes.find(([value]) => value === id);
  return theme?.[locale === 'fr' ? 2 : 1] ?? id;
}
