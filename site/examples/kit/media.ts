/**
 * Plays on `video` the file the viewer picks with `picker`, in place of the stream it played,
 * then calls `picked(name)`. A paused video stays paused on its new file, and a file the
 * browser cannot play leaves it paused, never an unhandled refusal. The address of the file
 * played before is released, so picking again and again holds one file in memory, not every one.
 */
export function playPickedVideo(
  picker: HTMLInputElement,
  video: HTMLVideoElement,
  picked: (name: string) => void = () => {},
) {
  let address: string | null = null;
  picker.addEventListener('change', () => {
    const [file] = picker.files ?? [];
    if (!file) return;
    const playing = !video.paused;
    if (address) URL.revokeObjectURL(address);
    address = URL.createObjectURL(file);
    video.srcObject = null;
    video.src = address;
    if (playing) video.play().catch(() => {});
    picked(file.name);
  });
}
