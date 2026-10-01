import type { Engine } from './engineTypes.ts';
import { kitWord } from './words.ts';
import { announce } from './banner.ts';

type World = ReturnType<typeof Engine.createWorld>;
/** The entry keeps user activation, shows unsupported hardware plainly, and handles browser end. */
export async function xrControls(world: World, ar = false, entered?: () => void | Promise<void>) {
  const button = document.createElement('button');
  button.style.cssText =
    'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:12px 24px;z-index:10;font:16px system-ui';
  button.disabled = true;
  button.textContent = kitWord('Checking XR support…', 'xr', 'checking');
  document.body.append(button);
  await world.ready;
  const supported = await world.xr.supported(ar ? 'immersive-ar' : 'immersive-vr');
  const label = kitWord(ar ? 'Enter AR' : 'Enter VR', 'xr', ar ? 'enterAR' : 'enterVR');
  button.textContent = supported
    ? label
    : kitWord('XR unavailable on this browser or device', 'xr', 'unavailable');
  button.disabled = !supported;
  button.onclick = () => {
    button.disabled = true;
    // No await before enter: the browser sees this button's user activation.
    const opening = ar ? world.xr.enterAR() : world.xr.enterVR();
    void opening
      .then(async () => {
        world.xr.session?.addEventListener(
          'end',
          () => {
            button.disabled = false;
            button.textContent = label;
          },
          { once: true },
        );
        await entered?.();
      })
      .catch(async (error) => {
        await world.xr.exit();
        announce(String(error));
        button.disabled = false;
      });
  };
  window.addEventListener('pagehide', () => world.dispose(), { once: true });
}
