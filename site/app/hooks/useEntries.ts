import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '../../content/locale.ts';
import type { PortalEntry } from '../../content/model.ts';
import { writtenEntries } from '../portal/written.ts';

/**
 * The entries in `locale`: the written ones at once, every entry — the generated API reference
 * with them, in the language's translation — once their chunks have loaded. It loads when `wanted` says so (the API area), or a
 * moment after the first page, so that the search finds the reference too.
 */
export function useEntries(locale: Locale, wanted: boolean) {
  const written = useMemo(() => writtenEntries(locale), [locale]);
  const [all, setAll] = useState<{ locale: Locale; entries: PortalEntry[] } | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setAsked(true), 1000);
    return () => clearTimeout(timer);
  }, []);
  const load = wanted || asked;
  useEffect(() => {
    if (!load) return;
    let live = true;
    void import('../portal/data.ts')
      .then(({ loadEntries }) => loadEntries(locale))
      .then((entries) => {
        if (live) setAll({ locale, entries });
      });
    return () => {
      live = false;
    };
  }, [load, locale]);
  const ready = all?.locale === locale;
  return { entries: ready ? all.entries : written, complete: ready };
}
