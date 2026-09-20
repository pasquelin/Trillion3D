import { Card } from './UI.jsx';
import { Modal } from './Modal.jsx';
export function ImageCard({ title, src, alt, enlargeLabel, closeLabel }) {
  return (
    <Card surface="nested" title={title}>
      <img className="w-full rounded-box" loading="lazy" src={src} alt={alt} />
      <Modal imageOnly title={title} triggerLabel={enlargeLabel} closeLabel={closeLabel}>
        {() => <img className="max-w-[92vw] max-h-[88dvh] object-contain" src={src} alt={alt} />}
      </Modal>
    </Card>
  );
}
