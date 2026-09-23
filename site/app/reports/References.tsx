import { useWords } from '../i18n.ts';
import { Table } from '../ui/Table.tsx';
import { Card } from '../ui/Card.tsx';
import { reportCopy } from '../../reports/copy.ts';
import type { Locale } from '../../content/locale.ts';

interface ReferencesProps {
  locale: Locale;
}

export function References({ locale }: ReferencesProps) {
  const c = reportCopy(locale);
  const t = useWords(locale);
  const rows = [
    [t('references.clusterTriangles'), '128'],
    [t('references.groupClusters'), '8–32'],
    [t('references.streamingPage'), '128 KiB'],
    [t('references.geometryPool'), '512 MB'],
    [t('references.triangleFormat'), '8.7 B'],
    [t('references.gpuVisibility'), '2.5 ms'],
    [t('references.gpuMaterials'), '2.084 ms'],
    [t('references.cpu'), '0.05 ms'],
  ];
  return (
    <Card id="report-references" title={c.references}>
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
    </Card>
  );
}
