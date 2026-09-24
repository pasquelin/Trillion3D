import { useId } from 'react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

interface PanelProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  title: ReactNode;
}

/**
 * A side panel of a tool page: a column on the page's second surface under a small title that
 * names it, scrolling on its own.
 */
export function Panel({ title, children, className = '', ...props }: PanelProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={`flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto bg-base-200 p-3 ${className}`}
      {...props}
    >
      <h2 id={titleId} className="text-xs font-bold uppercase tracking-widest opacity-70">
        {title}
      </h2>
      {children}
    </section>
  );
}
