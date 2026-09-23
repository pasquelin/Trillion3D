import type { ReactNode } from 'react';

interface Step {
  id: string;
  href: string;
  title: ReactNode;
  text: ReactNode;
}

/** A numbered DaisyUI list: steps in the order the reader takes them, each a link. */
export function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="list rounded-box border border-base-300 bg-base-200">
      {steps.map((step, index) => (
        <li key={step.id} className="list-row">
          <span className="font-mono text-2xl font-thin tabular-nums opacity-60">
            {String(index + 1).padStart(2, '0')}
          </span>
          <a className="grid grid-cols-1 gap-1 hover:text-primary" href={step.href}>
            <strong>{step.title}</strong>
            <span className="text-sm text-base-content/75">{step.text}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

interface Link {
  id: string;
  href: string;
  label: ReactNode;
  /** One line under the name: what it does. */
  summary?: ReactNode;
}

/** A DaisyUI menu of links, each a code name with what it does under it. */
export function LinkMenu({ links }: { links: Link[] }) {
  return (
    <ul className="menu w-full min-w-0 flex-nowrap p-0">
      {links.map((link) => (
        <li key={link.id} className="min-w-0 flex-nowrap">
          <a className="flex min-w-0 flex-col items-start gap-1 py-2" href={link.href}>
            <code className="max-w-full font-semibold wrap-anywhere">{link.label}</code>
            {link.summary && (
              <span className="line-clamp-2 max-w-full text-sm opacity-70">{link.summary}</span>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}
