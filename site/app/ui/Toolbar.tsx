import type { ReactNode } from 'react';
import { Button } from './Button.tsx';

/**
 * A tool page's bar: a band of its own surface the whole width of the page, right under the
 * header, its menus and tools wrapping on narrow screens. `base-300`, the step furthest from the
 * page's own `base-100`, keeps the band reading apart from the content under it in both themes;
 * the border is a `base-content` tint rather than another base shade, which would fade into the
 * band's own fill.
 */
export function Toolbar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-base-content/10 bg-base-300 px-2 py-1 sm:px-4"
    >
      {children}
    </div>
  );
}

/** A thin rule between two groups of a toolbar. */
export function ToolbarDivider() {
  return <span aria-hidden="true" className="hidden h-6 w-px bg-base-content/15 sm:block" />;
}

interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}

/** A choice of one among a few, as joined buttons: the chosen one pressed and filled. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedProps<T>) {
  return (
    <div className="join h-8" role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant={option.value === value ? 'primary' : 'ghost'}
          className="join-item h-full"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
