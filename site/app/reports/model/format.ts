import type { Locale } from '../../../content/locale.ts'

/** A metric's value as the reports print it, in the reader's locale: a dash when none. */
export function formatValue(value: number | null | undefined, locale: Locale, unit = ''): string {
  if (value === null || value === undefined) return '—'
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit ? 2 : 0 }).format(value)}${unit ? ` ${unit}` : ''}`
}
