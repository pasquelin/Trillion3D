/** Builds the whole site into `dist/site/`: styles, engine runtime, demo maths, portal, statics. */
import { buildSite } from './docs/site.mjs';

await buildSite();
