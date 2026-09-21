import type { ReactElement } from 'react';
import type { ThemeTabsProps } from '../types/gallery.ts';
import { TabsMenu } from '../components/TabsMenu.tsx';
import { themeLabel } from './roadmapThemes.ts';

const primary = ['transforms', 'camera', 'geometry', 'animation'];

export function ThemeTabs({ active, available, locale, onSelect }: ThemeTabsProps): ReactElement {
  const french = locale === 'fr';
  return (
    <TabsMenu
      value={active}
      options={available.map((value) => ({ value, label: themeLabel(value, locale) }))}
      primary={primary}
      allLabel={french ? 'Tous' : 'All'}
      moreLabel={french ? 'Plus' : 'More'}
      ariaLabel={french ? 'Catégories d’exemples' : 'Example categories'}
      onChange={onSelect}
    />
  );
}
