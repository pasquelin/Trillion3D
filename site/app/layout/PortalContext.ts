import { createContext, useContext } from 'react';
import type { PortalEntry } from '../../content/model.ts';
import type { PortalRoute } from '../portal/routes.ts';

interface Portal {
  route: PortalRoute;
  /** Every entry, in the route's language. */
  entries: PortalEntry[];
}

export const PortalContext = createContext<Portal>({
  route: { locale: 'en', area: 'learn', id: 'home' },
  entries: [],
});

/** The current route and the entries in its language, as the shell's parts read them. */
export const usePortal = () => useContext(PortalContext);
