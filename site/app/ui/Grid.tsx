import type { ReactNode } from 'react';

/** Cards side by side, as many columns as the width holds. */
export function Grid({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
  );
}
