import type { ReactNode } from 'react'

/** Cards side by side, as many columns as the width holds; `dense` for picture tiles, one column
 * more at each width. */
export function Grid({ children, dense = false }: { children: ReactNode; dense?: boolean }) {
  const columns = dense
    ? 'grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4'
    : 'grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'
  return <div className={`grid min-w-0 ${columns}`}>{children}</div>
}
