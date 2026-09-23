import { useRef } from 'react';
import type { ReactNode } from 'react';

interface LinkMenuItem {
  href: string;
  label: string;
  /** The language the link's page is in, when it is one. */
  hrefLang?: string;
  current: boolean;
}

interface LinkMenuProps {
  /** What the closed menu shows. */
  children: ReactNode;
  /** What the menu offers, for assistive technology. */
  label: string;
  items: LinkMenuItem[];
  className?: string;
}

/** A DaisyUI dropdown of links: a small button that opens a list of places to go, the current
 *  one marked; a label too long for the list ends in an ellipsis. */
export function LinkMenu({ children, label, items, className = '' }: LinkMenuProps) {
  const menu = useRef<HTMLDetailsElement | null>(null);
  const close = () => {
    if (menu.current) menu.current.open = false;
  };
  return (
    <details ref={menu} className="dropdown dropdown-end">
      <summary
        className={`btn btn-ghost btn-md list-none [&::-webkit-details-marker]:hidden ${className}`}
        aria-label={label}
      >
        {children}
      </summary>
      <ul className="menu dropdown-content z-50 mt-2 w-48 max-w-[80vw] rounded-box border border-base-300 bg-base-200 text-base-content shadow-lg">
        {items.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              hrefLang={item.hrefLang}
              aria-current={item.current ? 'page' : undefined}
              className={`min-w-0 ${item.current ? 'menu-active' : ''}`}
              onClick={close}
            >
              <span className="truncate">{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
