import { PLAN_PIPELINE_MASK } from './planEntry.ts';

/** Cull mode of the entry, whoever applies it: its rank among the three pipelines of its mode. */
export const planCull = (entry: number) => (entry & PLAN_PIPELINE_MASK) % 3;
