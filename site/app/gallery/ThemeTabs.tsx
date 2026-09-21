import type { Locale } from '../../content/locale.ts';
import { TabsMenu } from '../components/TabsMenu.tsx';
import { themeLabel } from './lessonThemes.ts';

const primary = ['transforms', 'camera', 'geometry', 'lighting'];

interface ThemeTabsProps {
  active: string;
  available: string[];
  locale: Locale;
  onSelect: (item: string) => void;
}

export function ThemeTabs({ active, available, locale, onSelect }: ThemeTabsProps) {
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
