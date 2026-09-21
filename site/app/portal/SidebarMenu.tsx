export interface SidebarMenuItem {
  key: string;
  label: string;
  /** Without a route the item is named but not yet reachable. */
  href?: string;
  active?: boolean;
  /** A dot after the label: the item is in development. */
  dot?: string;
}

export interface SidebarMenuGroup {
  id: string;
  title: string;
  items: SidebarMenuItem[];
  /** What the row counts, when not simply its items: the examples read done/total. */
  count?: string;
}

interface SidebarMenuProps {
  groups: SidebarMenuGroup[];
  open?: boolean;
  onNavigate?: () => void;
}

/** The sidebar's menu: one collapsible row per group, its count on the right, the items under
 * it, the current one marked. The Learn tree and the Examples list share it. */
export function SidebarMenu({ groups, open, onNavigate }: SidebarMenuProps) {
  return (
    <ul className="menu menu-md w-full p-0">
      {groups.map((group) => (
        <li key={group.id}>
          <details open={open ? true : undefined}>
            <summary>
              <span className="sidebar-section-title">{group.title}</span>
              <span className="sidebar-count">{group.count ?? group.items.length}</span>
            </summary>
            <ul>
              {group.items.map((item) => (
                <li key={item.key} className={item.href ? '' : 'menu-disabled'}>
                  {item.href ? (
                    <a
                      className={item.active ? 'menu-active' : ''}
                      href={item.href}
                      aria-current={item.active ? 'page' : undefined}
                      onClick={onNavigate}
                    >
                      <span>{item.label}</span>
                      {item.dot ? <span className="status-dot" title={item.dot} /> : null}
                    </a>
                  ) : (
                    <span>{item.label}</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ul>
  );
}
