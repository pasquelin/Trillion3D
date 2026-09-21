import { useState } from 'react';
import type { SyntheticEvent, ReactNode } from 'react';
import type { CardProps } from '../types/components.ts';
import { surfaceClass } from './UI.tsx';

export interface CollapseProps {
  title: ReactNode;
  children: ReactNode | (() => ReactNode);
  open?: boolean;
  surface?: CardProps['surface'];
}

/** Shared DaisyUI disclosure, closed by default for supporting technical details. */
export function Collapse({ title, children, open = false, surface = 'default' }: CollapseProps) {
  const [expanded, setExpanded] = useState<boolean>(open);
  return (
    <details
      className={`collapse collapse-arrow border border-base-300 ${surfaceClass(surface)} min-w-0`}
      open={expanded || undefined}
      onToggle={(event: SyntheticEvent<HTMLDetailsElement>) =>
        setExpanded(event.currentTarget.open)
      }
    >
      <summary className="collapse-title font-semibold">{title}</summary>
      <div className="collapse-content min-w-0 grid gap-4">
        {typeof children === 'function' ? (expanded ? children() : null) : children}
      </div>
    </details>
  );
}
