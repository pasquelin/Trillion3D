import { useState } from 'react';
import { Select } from '../components/UI.tsx';
import { viewName } from '../../js/reports/names.js';
import { Section } from '../components/Section.tsx';
import { runOf, sceneName } from '../../js/reports/presentation.js';
import { ProfileReading } from './ProfileReading.tsx';
import type { Report, ReportRecord } from '../types/reports.ts';
import type { Locale } from '../types/portal.ts';

interface ProfilesProps {
  report: Report;
  locale: Locale;
}

function SceneProfiles({ records, report, locale }: ProfilesProps & { records: ReportRecord[] }) {
  const [view, setView] = useState('sol'),
    [quality, setQuality] = useState('1');
  const views = [...new Set(records.map((r) => r.view))];
  const selectedView = views.includes(view) ? view : views[0];
  const readings = records.filter((r) => r.view === selectedView);
  const active = readings.find((r) => String(r.quality) === quality) ?? readings[0];
  if (!active) return null;
  return (
    <ProfileReading
      record={active}
      {...{ report, locale }}
      filters={
        <div className="flex items-center gap-3">
          <div className="w-40">
            <Select
              size="sm"
              aria-label={locale === 'fr' ? 'Point de vue' : 'Viewpoint'}
              value={selectedView}
              onChange={(event) => setView(event.target.value)}
            >
              {views.map((id) => (
                <option key={id} value={id}>
                  {viewName(id, locale)}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-24">
            <Select
              size="sm"
              aria-label={locale === 'fr' ? 'Détail' : 'Detail'}
              value={String(active.quality)}
              onChange={(event) => setQuality(event.target.value)}
            >
              {readings.map((r) => (
                <option key={r.id} value={String(r.quality)}>
                  {r.quality} px
                </option>
              ))}
            </Select>
          </div>
        </div>
      }
    />
  );
}

export function Profiles({ report, locale }: ProfilesProps) {
  const records = report.records.filter((r) => runOf(report, r) === 'mobile');
  return (
    <>
      {[...new Set(records.map((r) => r.scene))].map((scene) => (
        <Section key={scene} title={sceneName(scene)}>
          <SceneProfiles
            records={records.filter((r) => r.scene === scene)}
            {...{ report, locale }}
          />
        </Section>
      ))}
    </>
  );
}
