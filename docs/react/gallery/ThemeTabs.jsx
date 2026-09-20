import { TabsMenu } from '../components/TabsMenu.jsx';
import { themeLabel } from './roadmapThemes.js';

const primary = ['transforms', 'camera', 'geometry', 'animation'];

export function ThemeTabs({ active, available, locale, onSelect }) {
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
