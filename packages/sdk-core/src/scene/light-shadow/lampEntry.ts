import { PAGES } from './pageModel.ts';
import { LAMP_FACE_ENTRIES } from './virtual.ts';

/** What a relative lamp entry names: face, mip and page, written into `out`. */
export function decodeLampEntry(relative: number, out: Int32Array) {
  const face = Math.floor(relative / LAMP_FACE_ENTRIES),
    rest = relative - face * LAMP_FACE_ENTRIES,
    mip = PAGES.shadowLampEntryMip(rest),
    local = PAGES.shadowLampEntryLocal(rest),
    pages = PAGES.shadowLampMipPages(mip);
  out[0] = face;
  out[1] = mip;
  out[2] = PAGES.shadowFacePageX(pages, local);
  out[3] = PAGES.shadowFacePageY(pages, local);
  return out;
}
