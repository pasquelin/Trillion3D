import { Card } from './Card.tsx';
import { ModalTrigger } from './Modal.tsx';

interface ImageCardProps {
  title: string;
  src: string;
  alt: string;
  enlargeLabel: string;
  closeLabel: string;
}

export function ImageCard({ title, src, alt, enlargeLabel, closeLabel }: ImageCardProps) {
  return (
    <Card surface="nested" title={title}>
      <img className="w-full rounded-box" loading="lazy" src={src} alt={alt} />
      <ModalTrigger size="image" title={title} label={enlargeLabel} closeLabel={closeLabel}>
        <img className="max-w-[92vw] max-h-[88dvh] object-contain" src={src} alt={alt} />
      </ModalTrigger>
    </Card>
  );
}
