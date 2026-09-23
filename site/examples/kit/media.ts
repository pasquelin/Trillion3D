/**
 * Plays on `video` the file the viewer picks with `picker`, in place of the stream it played,
 * then calls `picked(name)`. The address of the file played before is released, so picking
 * again and again holds one file in memory, not every one.
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
    if (address) URL.revokeObjectURL(address);
    address = URL.createObjectURL(file);
    video.srcObject = null;
    video.src = address;
    void video.play();
    picked(file.name);
  });
}
