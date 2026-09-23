import { useWords } from '../i18n.ts';
import type { Locale } from '../../content/locale.ts';
import { exampleTitle, mosaicEntries, thumbnailOf } from '../examples/list.ts';
import { DocPage, SITE_NAME } from '../layout/DocPage.tsx';
import { LinkButton } from '../ui/Button.tsx';
import { Mosaic } from '../ui/Mosaic.tsx';
import { routeHref } from './routes.ts';

/** The home is the gallery: one line on what the engine does, where to start (the course and the
 * reference), then every ready example as a picture that opens it — the flagships large. */
export function Home({ locale }: { locale: Locale }) {
  const t = useWords(locale);
  return (
    <DocPage
      title={SITE_NAME}
      lead={t('home.title')}
      actions={
        <>
          <LinkButton
            variant="primary"
            href={routeHref({ locale, area: 'learn', id: 'create-a-world' })}
          >
            {t('home.start')}
          </LinkButton>
          <LinkButton variant="outline" href={routeHref({ locale, area: 'api', id: '' })}>
            {t('nav.api')}
          </LinkButton>
        </>
      }
    >
      <Mosaic
        tiles={mosaicEntries.map(({ entry, large }) => ({
          id: entry.id,
          href: routeHref({ locale, area: 'examples', id: entry.id }),
          src: thumbnailOf(entry.id),
          label: exampleTitle(entry.id, locale),
          large,
        }))}
      />
    </DocPage>
  );
}
