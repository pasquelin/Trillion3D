import { startTransition, useEffect, useState } from 'react';
import { dictionaryOf } from '../../content/i18n/dictionary.ts';
import { detectedLanguage, i18n, loadLanguage } from '../i18n.ts';
import { parseRoute } from '../portal/routes.ts';

/** The route the address names now: a route with no language takes the detected one. */
export const currentRoute = () => parseRoute(location.hash, detectedLanguage());

/** The route the address names, followed as it changes once its language is read — the page on
 *  screen stays until then —, and the route's language becomes the reader's remembered choice.
 *  The first route's language is read before the portal renders (`main.tsx`). */
export function useRoute() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    let latest = 0;
    const update = () => {
      const next = currentRoute();
      const ticket = ++latest;
      void loadLanguage(next.locale).then(() => {
        // A transition: the page on screen stays until the next one is ready, never a spinner.
        if (ticket === latest) startTransition(() => setRoute(next));
      });
    };
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
