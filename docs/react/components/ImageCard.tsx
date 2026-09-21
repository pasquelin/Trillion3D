import { Card } from './UI.tsx';
import { Modal } from './Modal.tsx';

export interface ImageCardProps {
  title: string;
  src: string;
  alt: string;
  enlargeLabel?: string;
  closeLabel?: string;
}

export function ImageCard({ title, src, alt, enlargeLabel, closeLabel }: ImageCardProps) {
  return (
    <Card surface="nested" title={title}>
      <img className="w-full rounded-box" loading="lazy" src={src} alt={alt} />
      <Modal imageOnly title={title} triggerLabel={enlargeLabel} closeLabel={closeLabel}>
        {() => <img className="max-w-[92vw] max-h-[88dvh] object-contain" src={src} alt={alt} />}
      </Modal>
    </Card>
  );
}
