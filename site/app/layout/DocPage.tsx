import type { ComponentPropsWithoutRef, ReactNode } from 'react';

/** The site's name: the home's title, and the end of every other page's. */
export const SITE_NAME = 'Web Geometry';

interface DocPageProps extends Omit<ComponentPropsWithoutRef<'article'>, 'title'> {
  /** A short line above the title: the area or the kind of page. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** One or two sentences under the title: what the page teaches. */
  lead?: ReactNode;
  /** The page's first actions, under the lead — or beside the title block with `inlineActions`. */
  actions?: ReactNode;
  /** Puts the actions beside the title and the lead instead of under them, the two blocks on one
   * row wrapping under the title on a narrow screen: for a header that reads as one line (the
   * home), not the usual stack of a page that is read top to bottom. */
  inlineActions?: boolean;
}

/** The reading page: a header (eyebrow, title, lead, actions), then the body in one column the
 * width of the content area — running text keeps its own readable measure. Every page that is
 * read rather than played is this template. */
export function DocPage({
  eyebrow,
  title,
  lead,
  actions,
  inlineActions = false,
  children,
  ...props
}: DocPageProps) {
  const heading = (
    <>
      {eyebrow && (
        <p className="font-mono text-xs font-bold uppercase tracking-widest text-primary">
          {eyebrow}
        </p>
      )}
      <h1 className="text-3xl font-bold break-words md:text-4xl">{title}</h1>
      {lead && <div className="text-lg leading-relaxed text-base-content/80">{lead}</div>}
    </>
  );
  return (
    <article className="grid w-full min-w-0 grid-cols-1 gap-8" {...props}>
      {typeof title === 'string' && (
        <title>{title === SITE_NAME ? title : `${title} · ${SITE_NAME}`}</title>
      )}
      {inlineActions ? (
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="grid min-w-0 grid-cols-1 gap-3">{heading}</div>
          {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
        </header>
      ) : (
        <header className="grid grid-cols-1 gap-3">
          {heading}
          {actions && <div className="flex flex-wrap gap-3 pt-2">{actions}</div>}
        </header>
      )}
      <div className="grid min-w-0 grid-cols-1 content-start gap-6">{children}</div>
    </article>
  );
}
