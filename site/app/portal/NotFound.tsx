import { useWords } from '../i18n.ts';
import { routeHref } from './routes.ts';
import { DocPage } from '../layout/DocPage.tsx';
import { Actions, LinkButton } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';
import type { Locale } from '../../content/locale.ts';

export function NotFound({ locale }: { locale: Locale }) {
  const t = useWords(locale);
  return (
    <DocPage eyebrow="404" title={t('notFound.title')} lead={t('notFound.lead')}>
      <Card title={t('notFound.wayBack')}>
        <Actions>
          <LinkButton variant="primary" href={routeHref({ locale, area: 'learn', id: 'home' })}>
            {t('notFound.home')}
          </LinkButton>
          <LinkButton variant="outline" href={routeHref({ locale, area: 'examples', id: '' })}>
            {t('notFound.examples')}
          </LinkButton>
        </Actions>
      </Card>
    </DocPage>
  );
}
