import type { ComponentPropsWithoutRef, ReactNode } from 'react';

/** The site's name: the home's title, and the end of every other page's. */
export const SITE_NAME = 'Web Geometry';

interface DocPageProps extends Omit<ComponentPropsWithoutRef<'article'>, 'title'> {
  /** A short line above the title: the area or the kind of page. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** One or two sentences under the title: what the page teaches. */
  lead?: ReactNode;
  /** The page's first actions, under the lead. */
  actions?: ReactNode;
}

/** The reading page: a header (eyebrow, title, lead, actions), then the body in one column the
 * width of the content area — running text keeps its own readable measure. Every page that is
 * read rather than played is this template. */
export function DocPage({ eyebrow, title, lead, actions, children, ...props }: DocPageProps) {
  return (
    <article className="grid w-full min-w-0 grid-cols-1 gap-8" {...props}>
      {typeof title === 'string' && (
        <title>{title === SITE_NAME ? title : `${title} · ${SITE_NAME}`}</title>
      )}
      <header className="grid grid-cols-1 gap-3">
        {eyebrow && (
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-primary">
            {eyebrow}
          </p>
        )}
        <h1 className="text-3xl font-bold break-words md:text-4xl">{title}</h1>
        {lead && <div className="text-lg leading-relaxed text-base-content/80">{lead}</div>}
        {actions && <div className="flex flex-wrap gap-3 pt-2">{actions}</div>}
      </header>
      <div className="grid min-w-0 grid-cols-1 content-start gap-6">{children}</div>
    </article>
  );
}
