import { REPORT_SECTIONS } from '../../reports/presentation.ts';
import { routeHref } from '../portal/routes.ts';
import type { PortalRoute } from '../types/portal.ts';

interface ReportNavigationProps {
  route: PortalRoute;
  onClose?: () => void;
}

export function ReportNavigation({ route, onClose }: ReportNavigationProps) {
  const [campaign = '', active = 'overview'] = route.id.split('/');
  return (
    <ul className="menu menu-md w-full p-0">
      {REPORT_SECTIONS.map(([id, en, fr]) => (
        <li key={id}>
          <a
            className={id === active ? 'menu-active' : ''}
            aria-current={id === active ? 'page' : undefined}
            onClick={onClose}
            href={routeHref({ ...route, id: `${campaign}/${id}` })}
          >
            {route.locale === 'fr' ? fr : en}
          </a>
        </li>
      ))}
    </ul>
  );
}
