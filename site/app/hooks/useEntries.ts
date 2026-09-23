import { useEffect, useMemo, useState } from 'react';
import type { Locale } from '../../content/locale.ts';
import type { PortalEntry } from '../../content/model.ts';
import { writtenEntries } from '../portal/written.ts';

/**
 * The entries in `locale`: the written ones at once, every entry — the generated API reference
 * with them — once its chunk has loaded. It loads when `wanted` says so (the API area, the
 * search), or a moment after the first page, so that it is there before the reader asks.
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
    void import('../portal/data.ts').then(({ entriesIn }) => {
      if (live) setAll({ locale, entries: entriesIn(locale) });
    });
    return () => {
      live = false;
    };
  }, [load, locale]);
  const ready = all?.locale === locale;
  return { entries: ready ? all.entries : written, complete: ready };
}
