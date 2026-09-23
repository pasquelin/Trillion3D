import { startTransition, useEffect, useState } from 'react';
import { parseRoute } from '../portal/routes.ts';

const currentRoute = () =>
  parseRoute(location.hash, document.documentElement.lang === 'fr' ? 'fr' : 'en');

/** The route the address names, followed as it changes. */
export function useRoute() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    // A transition: the page on screen stays until the next one is ready, never a spinner.
    const update = () => startTransition(() => setRoute(currentRoute()));
    addEventListener('hashchange', update);
    return () => removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    document.documentElement.lang = route.locale;
  }, [route.locale]);
  return route;
}
