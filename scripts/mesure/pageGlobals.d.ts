// The measurement pages publish GPU incidents (lost context, lost device) on `globalThis`,
// read back by the harness through `page.evaluate`. One ambient declaration, shared by every
// page module and by `serie.ts`/`seriePage.ts` on the Node side.
export {};

declare global {
  var incidentsGpu: string[] | undefined;
}
