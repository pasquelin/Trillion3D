import roadmap from '../../content/gallery-roadmap.json';
import { local } from '../../content/locale.ts';
import { routeHref } from '../portal/routes.ts';
import type { PortalRoute } from '../portal/routes.ts';
import type { SidebarMenuGroup } from '../portal/SidebarMenu.tsx';

/** The Examples sidebar: one group per theme counting done/total, one item per example,
 * reachable once it has a file, the current one active. */
export function examplesMenu(route: PortalRoute): SidebarMenuGroup[] {
  return roadmap.themes.map((theme) => {
    const entries = roadmap.entries.filter((entry) => entry.theme === theme.id);
    return {
      id: theme.id,
      title: local(theme.title, route.locale),
      count: `${entries.filter((entry) => entry.file).length}/${entries.length}`,
      items: entries.map((entry) => ({
        key: entry.id,
        label: local(entry.title, route.locale),
        href: entry.file ? routeHref({ ...route, id: entry.id }) : undefined,
        active: entry.id === route.id,
      })),
    };
  });
}
