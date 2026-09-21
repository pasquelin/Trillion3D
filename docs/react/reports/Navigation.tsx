import type { ReactElement } from 'react';
import { REPORT_SECTIONS } from '../../js/reports/presentation.js';
import { routeHref } from '../../js/portal/routes.js';
import type { PortalRoute } from '../types/portal.ts';

export interface ReportNavigationProps {
  route: PortalRoute;
  onClose?: () => void;
}

export function ReportNavigation({ route, onClose }: ReportNavigationProps): ReactElement {
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
