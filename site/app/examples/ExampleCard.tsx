import { useWords } from '../i18n.ts';
import { Badge } from '../ui/Badge.tsx';
import { Card } from '../ui/Card.tsx';
import { Note } from '../ui/Text.tsx';
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
      <Card className="h-full overflow-hidden shadow-sm">
        <div className="aspect-[16/10] overflow-hidden rounded-box bg-base-300">
          <img
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            src={thumbnail}
            alt=""
          />
        </div>
        <Badge tone="primary" soft>
          {badge}
        </Badge>
        <h2 className="card-title text-lg">{title}</h2>
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
}

/** An example still to come: its title, "in progress", and — when it waits for the engine — the
 * feature it waits for. It opens nothing. */
export function PendingExampleCard({ title, locale, missing }: PendingProps) {
  const t = useWords(locale);
  return (
    <div aria-disabled="true" className="h-full opacity-75">
      <Card className="h-full overflow-hidden shadow-sm">
        <img
          className="aspect-[16/10] w-full rounded-box object-cover"
          src="./assets/example-in-progress.svg"
          alt=""
          loading="lazy"
        />
        <Badge tone="info" soft>
          {t('examples.inProgress')}
        </Badge>
        <h2 className="card-title text-lg">{title}</h2>
        {missing && <Note>{`${t('examples.waitsFor')} ${missing}`}</Note>}
      </Card>
    </div>
  );
}
