// The measurement pages publish GPU incidents (lost context, lost device) on `globalThis`,
// read back by the harness through `page.evaluate`. One ambient declaration, shared by every
// page module and by `serie.ts`/`seriePage.ts` on the Node side.
export {};

declare global {
  // eslint-disable-next-line no-var
  var incidentsGpu: string[] | undefined;
}
