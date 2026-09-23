import { useId } from 'react';

interface SidebarMenuItem {
  key: string;
  label: string;
  href: string;
  active?: boolean;
  /** A dot after the label: the item is in development. */
  dot?: string;
}

export interface SidebarMenuGroup {
  id: string;
  title: string;
  items: SidebarMenuItem[];
}

/** The sidebar's DaisyUI menu, an accordion: one row per group with its count, one group open at
 * a time — at first the one holding the current page, else the first —, the items on one line
 * each (the whole label in their title), the current one marked. Every area's sidebar is this
 * menu, the examples' excepted. */
export function SidebarMenu({ groups }: { groups: SidebarMenuGroup[] }) {
  // One accordion: the details share a name, so opening one closes the other.
  const accordion = useId();
  const current = Math.max(
    0,
    groups.findIndex((group) => group.items.some((item) => item.active)),
  );
  return (
    <ul className="menu menu-md w-full min-w-0 flex-nowrap gap-1 p-0">
      {groups.map((group, index) => (
        <li key={group.id} className="min-w-0 flex-nowrap">
          <details name={accordion} open={index === current}>
            <summary className="flex min-w-0 font-semibold">
              <span className="min-w-0 flex-1 truncate">{group.title}</span>
              <span className="badge badge-ghost badge-sm">{group.items.length}</span>
            </summary>
            <ul className="min-w-0 max-w-full">
              {group.items.map((item) => (
                <li key={item.key} className="min-w-0 flex-nowrap">
                  <a
                    className={`flex min-w-0 ${item.active ? 'menu-active' : ''}`}
                    href={item.href}
                    title={item.label}
                    aria-current={item.active ? 'page' : undefined}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.dot && (
                      <span
                        className="status status-warning"
                        title={item.dot}
                        aria-label={item.dot}
                      />
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ul>
  );
}
