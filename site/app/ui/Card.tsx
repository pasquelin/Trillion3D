import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export interface CardProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  title?: ReactNode;
  surface?: 'default' | 'nested' | 'inset';
  /** A picture across the top of the card. */
  image?: string;
}

export const CARD_SURFACE = 'card bg-base-200 border border-base-300';

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
  className = '',
  surface = 'default',
  image,
  ...props
}: CardProps) {
  return (
    <section
      className={`card ${surfaceClass(surface)} border border-base-300 min-w-0 ${className}`}
      {...props}
    >
      {image && (
        <figure>
          <img className="aspect-video w-full object-cover" src={image} alt="" loading="lazy" />
        </figure>
      )}
      <div className="card-body gap-4 p-4">
        {title && <h2 className="card-title text-lg">{title}</h2>}
        {children}
      </div>
    </section>
  );
}
