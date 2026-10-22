/**
 * THE WORLD'S CELLS AS THE CUT FOLLOWS THEM, the contract between the cut's follower
 * (`worldFollow.ts`) and those who tell it or read it: the partition, which tells each HLOD cell
 * what it is, which files a blocking load waits for and whether the HLOD actors are on, and reads
 * which cells and files are visible (`../../hlod/hlodCells.ts`, `../../partition/cells.ts`); the
 * frame, which hands it the warm-up and the first image (`../../../frame/prepare/hlodWarm.ts`,
 * `../../../frame/loop/firstImage.ts`); the blend pass, which reads where a file's word lies
 * (`../../../blend/keyRecords.ts`).
 */
import type { ActorWarmth } from './worldWarm.ts'

/** Where a placement lies (`GpuSelection.placeInCell`, `worldPlacements.ts`): its HLOD 0 cell, -1
 *  for none, the world DAG's instance it lies in (0 the first), its cell file and whether that
 *  file's main cell is wished — its row drawn as the source mesh —, or whether it is a row of
 *  `cell`'s own actor (`actor`, `../../hlod/hlodRows.ts`), in no file. */
export type CellLink = [
  cell: number,
  instance?: number,
  file?: number,
  main?: boolean,
  actor?: boolean,
]

/** The world's chain of HLOD cells and its cell files as the cut follows them. */
export type WorldCells = {
  /** HLOD cell `cell` of instance `instance` is told `word` (`CELL_TOLD`): wished, every cell file
   *  of an HLOD 0 cell placed or one refused for good, its actor's hold failed for good; whether it
   *  moved. */
  show(instance: number, cell: number, word: number): boolean
  /** Whether the cell was visible at the last cut. */
  visible(instance: number, cell: number): boolean
  /** Whether cell file `file` of instance `instance` was shown as its main cell at the last cut
   *  (`worldFiles.ts`). */
  fileShown(instance: number, file: number): boolean
  /** The slot of the word of cell file `file` of instance `instance`, -1 while no placement of the
   *  cut lies in it. */
  fileSlot(instance: number, file: number): number
  /** Advanced whenever a file takes a word slot or gives one back: what names a slot is stale. */
  readonly slotRevision: number
  /** The packed page of world rank 0 in instance `instance`: its rank `r` is packed page
   *  `pageBase(instance) + r`. */
  pageBase(instance: number): number
  /** Each cell of `instance` whose visibility moved since the last call for that instance, told to
   *  `visit`; every cell at the first call, or once more moved than it has cells. */
  moved(instance: number, visit: (cell: number) => void): void
  /** A switch that draws an HLOD actor waits on its warm-up (`ActorWarmth`, `worldWarm.ts`). */
  warmWith(warmth?: ActorWarmth): void
  /** Whether a switch waits on an actor's warm-up: the view keeps drawing till it is done. */
  readonly warming: boolean
  /** Whether every cell and cell file wished is visible, but a lost cell, and no cell waits to be
   *  switched again: what the session's first image waits for
   *  (`../../../frame/loop/firstImage.ts`). */
  readonly shown: boolean
  /** The first image is shown: the initial load is over, and a switch waits on a warm-up from now
   *  on. */
  firstImageShown(): void
  /** The HLOD actors load and draw (`hlodEnabled`), or not: off, no cell draws its actor nor its
   *  placements as its HLOD 0 actor, and no switch waits on a warm-up. */
  hlodEnabled(on: boolean): void
  /** The cells and files the partition places draw (`activated`), or are loaded and not activated:
   *  placed, counted and switched as ever, and drawing nothing — no file, no HLOD 0 actor, no HLOD
   *  actor (`worldFiles.ts`, `hide`). */
  activated(on: boolean): void
  /** The cell files of instance `instance` a load blocking on slow streaming waits for, read as
   *  they stand at each cut, none once it blocks no more (`../../partition/slowStreaming.ts`):
   *  meanwhile no HLOD cell turns visible, no other file shows and no switch waits on a warm-up. */
  blockingLoad(instance: number, waits: ReadonlySet<number>): void
  /** Advanced whenever a cell's or a file's visibility moved. */
  readonly revision: number
}
