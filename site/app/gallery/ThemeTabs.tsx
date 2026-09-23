import { useWords } from '../i18n.ts';
import type { Locale } from '../../content/locale.ts';
import { TabsMenu } from '../ui/TabsMenu.tsx';
import type { THEMES } from './lessonThemes.ts';

const primary = ['transforms', 'camera', 'geometry', 'lighting'];

interface ThemeTabsProps {
  active: string;
  available: (typeof THEMES)[number][];
  locale: Locale;
  onSelect: (item: string) => void;
}

export function ThemeTabs({ active, available, locale, onSelect }: ThemeTabsProps) {
  const t = useWords(locale);
  return (
    <TabsMenu
      value={active}
      options={available.map((value) => ({ value, label: t(`themes.${value}`) }))}
      primary={primary}
      allLabel={t('gallery.all')}
      moreLabel={t('gallery.more')}
      ariaLabel={t('gallery.categories')}
      onChange={onSelect}
    />
  );
}
