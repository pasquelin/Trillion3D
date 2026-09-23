import { useWords } from '../i18n.ts';
import { Badge } from '../ui/Badge.tsx';
import { Card } from '../ui/Card.tsx';
import { Cover } from '../ui/Thumbnail.tsx';
import { Note, TextLink } from '../ui/Text.tsx';
import { issueUrl } from '../../content/model.ts';
import type { Locale } from '../../content/locale.ts';

interface ExampleCardProps {
  title: string;
  href: string;
  badge: string;
  /** The example's settled render. */
  thumbnail: string;
}

/** A ready example: its thumbnail, its theme and its title, opening the example. */
export function ExampleCard({ title, href, badge, thumbnail }: ExampleCardProps) {
  return (
    <a
      className="block h-full rounded-box focus-visible:outline-2 focus-visible:outline-primary"
      href={href}
    >
      <Card
        className="h-full overflow-hidden shadow-sm"
        media={<Cover src={thumbnail} />}
        title={title}
      >
        <Badge tone="primary" soft>
          {badge}
        </Badge>
        <span className="self-end text-xl text-primary" aria-hidden="true">
          →
        </span>
      </Card>
    </a>
  );
}

interface PendingProps {
  title: string;
  locale: Locale;
  /** The engine feature the example waits for, when it waits for one. */
  missing?: string;
  /** The issue that delivers it, for an example already written and waiting for the engine. */
  issue?: number;
}

/** An example still to come: its title, "in progress" — or "waiting for the engine" and its issue
 * when it is written already —, and the feature it waits for. It opens nothing. */
export function PendingExampleCard({ title, locale, missing, issue }: PendingProps) {
  const t = useWords(locale);
  return (
    <div aria-disabled="true" className="h-full opacity-75">
      <Card
        className="h-full overflow-hidden shadow-sm"
        media={<Cover src="./assets/example-in-progress.svg" />}
        title={title}
      >
        <Badge tone="info" soft>
          {t(issue ? 'examples.waitingEngine' : 'examples.inProgress')}
        </Badge>
        {missing && (
          <Note>
            {`${t('examples.waitsFor')} ${missing}`}
            {issue && (
              <>
                {' — '}
                <TextLink href={issueUrl(issue)}>#{issue}</TextLink>
              </>
            )}
          </Note>
        )}
      </Card>
    </div>
  );
}
