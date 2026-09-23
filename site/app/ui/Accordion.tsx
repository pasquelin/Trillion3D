import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { CARD_SURFACE } from './Card.tsx';

interface AccordionProps extends Omit<ComponentPropsWithoutRef<'details'>, 'title'> {
  title: ReactNode;
}

/** Content disclosure shares the same surface as Card and Section. */
export function Accordion({ title, children, ...props }: AccordionProps) {
  return (
    <details className={`${CARD_SURFACE} collapse collapse-arrow`} {...props}>
      <summary className="collapse-title text-sm font-semibold">{title}</summary>
      <div className="collapse-content">{children}</div>
    </details>
  );
}
