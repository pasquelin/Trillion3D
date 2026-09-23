import type { ReactNode } from 'react';

/** Cards side by side, as many columns as the width holds; `dense`, twice as many and smaller. */
export function Grid({ dense = false, children }: { dense?: boolean; children: ReactNode }) {
  const columns = dense
    ? 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6'
    : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3';
  return <div className={`grid min-w-0 gap-4 ${columns}`}>{children}</div>;
}
