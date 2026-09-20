import { useState } from 'react';
import { surfaceClass } from './UI.jsx';
/** Shared DaisyUI disclosure, closed by default for supporting technical details. */
export function Collapse({ title, children, open = false, surface = 'default' }) {
  const [expanded, setExpanded] = useState(open);
  return (
    <details
      className={`collapse collapse-arrow border border-base-300 ${surfaceClass(surface)} min-w-0`}
      open={expanded || undefined}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="collapse-title font-semibold">{title}</summary>
      <div className="collapse-content min-w-0 grid gap-4">
        {typeof children === 'function' ? (expanded ? children() : null) : children}
      </div>
    </details>
  );
}
