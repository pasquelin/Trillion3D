import { t } from '../../content/i18n/index.ts';
import { apiIndex } from '../layout/menus.ts';
import { DocPage } from '../layout/DocPage.tsx';
import { usePortal } from '../layout/PortalContext.ts';
import { Card } from '../ui/Card.tsx';
import { LinkMenu } from '../ui/List.tsx';
import { Inline } from '../ui/Prose.tsx';

/** The API reference's landing page, one column: every family, every name in it and what it
 * does. */
export function ApiIndex() {
  const { route, entries } = usePortal();
  return (
    <DocPage
      eyebrow={t(route.locale, 'nav.api')}
      title={t(route.locale, 'api.title')}
      lead={t(route.locale, 'api.lead')}
    >
      {apiIndex(entries, route).map((group) => (
        <Card key={group.id} title={group.title}>
          <LinkMenu
            links={group.items.map((item) => ({
              ...item,
              summary: <Inline text={item.summary} />,
            }))}
          />
        </Card>
      ))}
    </DocPage>
  );
}
