import type { CardProps } from '../types/components.ts';
import { Card } from './UI.tsx';

export type SectionProps = CardProps;

/** A titled page section with the shared card surface and heading hierarchy. */
export function Section({ title, children, className = '', ...props }: SectionProps) {
  return (
    <Card title={title} className={className} {...props}>
      {children}
    </Card>
  );
}
