import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export interface CardProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  title?: ReactNode;
  /** A picture above the title: the card of a page a list opens. */
  media?: ReactNode;
  surface?: 'default' | 'nested' | 'inset';
}

const surfaces: Record<NonNullable<CardProps['surface']>, string> = {
  default: 'bg-base-200',
  nested: 'bg-base-100',
  inset: 'bg-base-300',
};

export const surfaceClass = (surface: CardProps['surface'] = 'default'): string =>
  surfaces[surface];

/** The DaisyUI card: one surface, one border, one title level for every boxed section. */
export function Card({
  children,
  title,
  media,
  className = '',
  surface = 'default',
  ...props
}: CardProps) {
  return (
    <section
      className={`card ${surfaceClass(surface)} border border-base-300 min-w-0 ${className}`}
      {...props}
    >
      <div className="card-body gap-4 p-4">
        {media}
        {title && <h2 className="card-title text-lg">{title}</h2>}
        {children}
      </div>
    </section>
  );
}
