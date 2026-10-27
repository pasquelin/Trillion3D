import { CONTACT_SHADOW_VIEW_RULES } from '../../../../sdk-core/src/contracts/contactShadowOptions.ts'
import { resolveSettingsStamped } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  NO_CONTACT_SHADOW_VIEW,
  type ContactShadowView,
} from '../../../../sdk-core/src/scene/light/contactShadowView.ts'
import { wantsPixelModels } from '../../materials/surface/subsurface.ts'
import { cameraForward } from '../../camera/forward.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { viewProj } from '../../frame/backend/helpers.ts'

/** The view's contact shadow settings, read by the stamped reader into this one object: an image where
 *  no setting was written costs a compare. */
const view: ContactShadowView = { ...NO_CONTACT_SHADOW_VIEW }

/** Hands the light store the view's contact shadow settings, which it folds into every light's lanes
 *  (`SceneLightStore.setContactShadowView`); at the image's entry, before the lit program's key is read. */
export function followContactShadows(rt: WebgpuPagesRuntime) {
  resolveSettingsStamped(CONTACT_SHADOW_VIEW_RULES, rt.context, view)
  rt.lights.store.setContactShadowView(view)
}

/**
 * Whether the opaque lit passes hold the code of the contact shadows: a light casts a ray of its own
 * (`LightStore.contacts`), or a surface may be of the eye or hair model, whose rays the models make
 * whatever the switch and the lights say (`wantsPixelModels`, the thin target that holds their data being
 * drawn). The key of the program reads it (`ContractKey.contactless`).
 */
export const castsContactShadows = (rt: WebgpuPagesRuntime) =>
  rt.lights.store.contacts > 0 || (!!rt.gpu.surfaces?.hasSubsurface && wantsPixelModels(rt))

/** The camera's forward axis and the tangent of half its vertical field, a vec4 (`View.contact`). */
const CONTACT: [number, number, number, number] = [0, 0, -1, 1]

/** Hands the lit passes what their contact shadows' rays read of the view: the matrix the surfaces were
 *  drawn with, the camera's forward axis and the tangent of half its field. */
export function setContactShadowView(
  deferred: Pick<NonNullable<WebgpuPagesRuntime['gpu']['deferred']>, 'setContactShadows'>,
  cam: EngineCamera,
) {
  cameraForward(CONTACT, cam.world)
  CONTACT[3] = cam.perspective ? 1 / cam.projection[5] : 1
  deferred.setContactShadows(viewProj, CONTACT)
}
