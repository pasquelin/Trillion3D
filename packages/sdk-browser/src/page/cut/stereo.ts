import { selectVisiblePages } from './cut.ts';
import { createSelectionResult, type PageRecord, type SelectionResult } from './state.ts';
import type { CutView } from './viewSet.ts';
import type { ClusterRoot } from '../selection/types.ts';
import type { EngineCamera } from '../../camera/world.ts';

/** The two eye images consume one cut; residency advances once for the headset frame. */
export interface StereoCut {
  views: readonly CutView[];
  readonly revision: number;
  readonly nodesTested: number;
  transparent?: boolean;
  select<T extends PageRecord>(
    roots: readonly ClusterRoot<T>[],
    camera: EngineCamera,
    options: Parameters<typeof selectVisiblePages<T>>[2],
    into?: T[],
  ): SelectionResult<T>;
  begin(views: readonly CutView[]): void;
  once(key: unknown): boolean;
}
export function createStereoCut(): StereoCut {
  const result = createSelectionResult<PageRecord>();
  const work = new Set<unknown>();
  let selected = false;
  let revision = 0;
  const previous: number[] = [];
  const cut: StereoCut = {
    views: [],
    get nodesTested() {
      return selected ? result.nodesTested : 0;
    },
    get revision() {
      return revision;
    },
    once(key) {
      if (work.has(key)) return false;
      work.add(key);
      return true;
    },
    begin(views) {
      work.clear();
      let at = 0,
        changed = false;
      const write = (value: number) => {
        if (previous[at] !== value) changed = true;
        previous[at++] = value;
      };
      for (const { camera, viewport } of views) {
        for (const value of camera.view) write(value);
        for (const value of camera.projection) write(value);
        write(camera.far);
        write(viewport[0]);
        write(viewport[1]);
      }
      changed ||= previous.length !== at;
      previous.length = at;
      if (changed) revision++;
      cut.views = views;
      selected = false;
    },
    select(roots, camera, options, into) {
      if (!selected) {
        selectVisiblePages(
          roots,
          camera,
          { ...options, views: cut.views, result, wanted: result.wanted },
          result.shown,
        );
        selected = true;
      }
      const shown = into ?? [],
        wanted = options.wanted ?? [];
      shown.length = result.shown.length;
      wanted.length = result.wanted.length;
      for (let i = 0; i < shown.length; i++) shown[i] = result.shown[i] as (typeof shown)[number];
      for (let i = 0; i < wanted.length; i++)
        wanted[i] = result.wanted[i] as (typeof wanted)[number];
      return Object.assign(options.result ?? createSelectionResult(), result, { shown, wanted });
    },
  };
  return cut;
}
