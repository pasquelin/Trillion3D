import { Table } from '../components/Table.tsx';
import { Section } from '../components/Section.tsx';
import { reportCopy } from '../../reports/copy.ts';
import type { Locale } from '../../content/locale.ts';

interface ReferencesProps {
  locale: Locale;
}

export function References({ locale }: ReferencesProps) {
  const c = reportCopy(locale),
    fr = locale === 'fr';
  const rows = [
    [fr ? 'Triangles par grappe' : 'Triangles per cluster', '128'],
    [fr ? 'Grappes par groupe' : 'Clusters per group', '8–32'],
    [fr ? 'Page de streaming' : 'Streaming page', '128 KiB'],
    [
      fr
        ? 'Pool géométrique par défaut (source secondaire)'
        : 'Default geometry pool (secondary source)',
      '512 MB',
    ],
    [fr ? 'Format en mémoire par triangle' : 'Memory format per triangle', '8.7 B'],
    [fr ? 'Visibilité GPU, démonstration PS5' : 'GPU visibility, PS5 demo', '2.5 ms'],
    [fr ? 'Matériaux GPU, démonstration PS5' : 'GPU materials, PS5 demo', '2.084 ms'],
    [fr ? 'CPU, démonstration PS5' : 'CPU, PS5 demo', '0.05 ms'],
  ];
  return (
    <Section id="report-references" title={c.references}>
      <p>{c.referenceNote}</p>
      <p>
        Unreal Engine · SIGGRAPH 2021 · <em>A Deep Dive into Nanite Virtualized Geometry</em>
      </p>
      <Table>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <a className="link" href="REFERENCE.md">
        {c.referenceLink}
      </a>
    </Section>
  );
}
