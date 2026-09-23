import type { ReactNode } from 'react';

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
