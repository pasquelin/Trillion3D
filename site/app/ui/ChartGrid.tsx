import { Children, isValidElement } from 'react';
import type { ReactNode } from 'react';

interface ChartGridProps {
  children: ReactNode;
  columns?: number;
}

/** Shared chart layout: an unpaired final chart occupies the available row. */
export function ChartGrid({ children, columns = 2 }: ChartGridProps) {
  const items = Children.toArray(children);
  return (
    <div className={`grid min-w-0 items-start gap-4 ${columns === 2 ? 'xl:grid-cols-2' : ''}`}>
      {items.map((child, index) => (
        <div
          key={isValidElement(child) && child.key ? child.key : index}
          className={
            columns === 2 && index === items.length - 1 && items.length % 2
              ? 'min-w-0 xl:col-span-2'
              : 'min-w-0'
          }
        >
          {child}
        </div>
      ))}
    </div>
  );
}
