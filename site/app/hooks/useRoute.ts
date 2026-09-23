import { startTransition, useEffect, useState } from 'react';
import { dictionaryOf } from '../../content/i18n/dictionary.ts';
import { i18n } from '../i18n.ts';
import { parseRoute } from '../portal/routes.ts';

const currentRoute = () => parseRoute(location.hash, i18n.resolvedLanguage);

/** The route the address names, followed as it changes: a route with no language takes the
 *  detected one, and the route's language becomes the reader's remembered choice. */
export function useRoute() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    // A transition: the page on screen stays until the next one is ready, never a spinner.
    const update = () => startTransition(() => setRoute(currentRoute()));
    addEventListener('hashchange', update);
    return () => removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    void i18n.changeLanguage(route.locale);
    const { hreflang, rtl } = dictionaryOf(route.locale).meta;
    document.documentElement.lang = hreflang;
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  }, [route.locale]);
  return route;
}
