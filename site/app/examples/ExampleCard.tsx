import { Badge } from '../ui/Badge.tsx';
import { Card } from '../ui/Card.tsx';
import { Cover } from '../ui/Thumbnail.tsx';

interface ExampleCardProps {
  title: string;
  href: string;
  badge: string;
  /** The example's settled render. */
  thumbnail: string;
  /** Existing placeholder art used when no captured thumbnail exists yet. */
  fallbackThumbnail?: string;
  /** A compact state/capability label for a written example parked on the engine. */
  state?: string;
}

/** A written example: its thumbnail or fallback, theme, state and title, opening the example. */
export function ExampleCard({
  title,
  href,
  badge,
  thumbnail,
  fallbackThumbnail,
  state,
}: ExampleCardProps) {
  return (
    <a
      className="block h-full rounded-box focus-visible:outline-2 focus-visible:outline-primary"
      href={href}
      title={title}
    >
      <Card
        className="h-full overflow-hidden shadow-sm"
        media={<Cover look="card" src={thumbnail} fallbackSrc={fallbackThumbnail} />}
        eyebrow={
          <div className="grid h-28 grid-rows-[1.5rem_4.5rem] gap-2 overflow-hidden">
            <Badge tone="primary" soft className="justify-self-start">
              {badge}
            </Badge>
            {state && (
              <Badge
                tone="info"
                soft
                className="h-[4.5rem] max-w-full items-start whitespace-normal py-1 text-start"
              >
                <span className="line-clamp-3" title={state}>
                  {state}
                </span>
              </Badge>
            )}
          </div>
        }
        title={<span className="line-clamp-2 h-14">{title}</span>}
      >
        <span className="mt-auto self-end text-xl text-primary" aria-hidden="true">
          →
        </span>
      </Card>
    </a>
  );
}
