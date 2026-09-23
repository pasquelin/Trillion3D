import { t } from '../content/i18n/index.ts';
import type { Locale } from '../content/locale.ts';
import type { PortalEntry } from '../content/model.ts';
import { Card } from './ui/Card.tsx';
import { Inline } from './ui/Prose.tsx';
import { FieldTable } from './ui/Table.tsx';

const code = (text: string | undefined) => (text ? <code>{text}</code> : null);

/** What a function takes: one row per parameter, its type, its default and what it does. */
export function Parameters({ entry, locale }: { entry: PortalEntry; locale: Locale }) {
  if (!entry.parameters?.length) return null;
  return (
    <Card title={t(locale, 'entry.parameters')}>
      <FieldTable
        head={['name', 'type', 'default', 'meaning'].map((key) => t(locale, `entry.${key}`))}
        rows={entry.parameters.map((row) => ({
          key: row.name,
          cells: [
            row.name,
            code(row.type),
            code(row.default),
            <Inline key="meaning" text={row.desc} />,
          ],
        }))}
      />
    </Card>
  );
}

/** What a function gives back: its type, and what it is. */
export function Returns({ entry, locale }: { entry: PortalEntry; locale: Locale }) {
  if (!entry.returns) return null;
  return (
    <Card title={t(locale, 'entry.returns')}>
      <p>
        {code(entry.returns.type)} — <Inline text={entry.returns.desc} />
      </p>
    </Card>
  );
}

/** What an object or a type holds: one row per member, and a written entry's own values. */
export function Members({ entry, locale }: { entry: PortalEntry; locale: Locale }) {
  const members = entry.members ?? [];
  const values = entry.values ?? [];
  if (!members.length && !values.length) return null;
  const typed = members.length > 0;
  return (
    <Card
      title={
        entry.valuesTitle ??
        t(
          locale,
          typed ? 'entry.members' : entry.kind === 'Type' ? 'entry.values' : 'entry.arguments',
        )
      }
    >
      <FieldTable
        head={(typed ? ['name', 'type', 'meaning'] : ['name', 'meaning']).map((key) =>
          t(locale, `entry.${key}`),
        )}
        rows={[
          ...members.map((row) => ({
            key: row.name,
            cells: [row.name, code(row.type), <Inline key="meaning" text={row.desc} />],
          })),
          ...values.map((row) => ({
            key: row.name,
            cells: typed
              ? [row.name, null, <Inline key="meaning" text={row.desc} />]
              : [row.name, <Inline key="meaning" text={row.desc} />],
          })),
        ]}
      />
    </Card>
  );
}
