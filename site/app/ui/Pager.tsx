import { LinkButton } from './Button.tsx';

/** One side of a pager: where it goes, what kind of step it is, and the page it names. */
interface PagerLink {
  href: string;
  caption: string;
  title?: string;
}

interface PagerProps {
  /** What the sequence is, for assistive technology. */
  label: string;
  previous?: PagerLink;
  next?: PagerLink;
  /** The small version, captions only, for the top of a page. */
  compact?: boolean;
}

/** The way through a sequence: the step before on the left, the step after on the right, one
 * row the page's width that stacks on phones. A side with no step is left out. */
export function Pager({ label, previous, next, compact = false }: PagerProps) {
  const text = ({ caption, title }: PagerLink) =>
    compact || !title ? caption : `${caption} — ${title}`;
  const size = compact ? 'sm' : 'md';
  const shape = compact ? '' : 'h-auto min-h-10 py-2 whitespace-normal';
  return (
    <nav
      aria-label={label}
      className={
        compact
          ? 'flex w-full flex-wrap gap-2'
          : 'flex flex-col gap-3 sm:flex-row sm:justify-between'
      }
    >
      {previous && (
        <LinkButton
          variant={compact ? 'ghost' : 'outline'}
          size={size}
          className={shape}
          href={previous.href}
          rel="prev"
        >
          ← {text(previous)}
        </LinkButton>
      )}
      {next && (
        <LinkButton
          variant={compact ? 'ghost' : 'primary'}
          size={size}
          className={`${shape} ${compact ? 'ml-auto' : 'sm:ml-auto'}`}
          href={next.href}
          rel="next"
        >
          {text(next)} →
        </LinkButton>
      )}
    </nav>
  );
}
