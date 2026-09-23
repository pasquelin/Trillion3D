import type { ReactNode } from 'react';

/** Two columns on wide screens — what the reader works with, then what it shows — one under the
 * other on narrow ones. */
export function Split({ read, observe }: { read: ReactNode; observe: ReactNode }) {
  return (
    <div
      data-columns
      className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,9fr)_minmax(0,11fr)]"
    >
      <div className="grid min-w-0 grid-cols-1 content-start gap-4">{read}</div>
      <div className="grid min-w-0 grid-cols-1 content-start gap-4">{observe}</div>
    </div>
  );
}
