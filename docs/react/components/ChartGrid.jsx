import { Children } from 'react';
/** Shared chart layout: an unpaired final chart occupies the available row. */
export function ChartGrid({ children, columns = 2 }) {
  const items = Children.toArray(children);
  return (
    <div className={`grid min-w-0 items-start gap-4 ${columns === 2 ? 'xl:grid-cols-2' : ''}`}>
      {items.map((child, index) => (
        <div
          key={child.key ?? index}
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
