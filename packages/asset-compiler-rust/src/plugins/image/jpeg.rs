//! Pilote JPEG, standard ISO/IEC 10918, décodé par la crate `image` (feature `jpeg`). Le décodage
//! ne réencode rien : la perte est celle du fichier source, le compilateur n'en ajoute aucune.
use super::{crate_image, DecodedImage, ImageDecoder, Plugin};

pub(super) static JPEG: Jpeg = Jpeg;
pub(super) struct Jpeg;

impl Plugin for Jpeg {
    fn name(&self) -> &'static str {
        "jpeg"
    }
    fn version(&self) -> &'static str {
        "jpeg-image-0.25"
    }
    /// Les deux extensions du même format, dans l'ordre où l'on cherche un fichier voisin.
    fn extensions(&self) -> &'static [&'static str] {
        &["jpg", "jpeg"]
    }
}

impl ImageDecoder for Jpeg {
    fn mime(&self) -> &'static str {
        "image/jpeg"
    }
    /// Le marqueur de début d'image, suivi du premier marqueur de segment.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(&[0xFF, 0xD8, 0xFF])
    }
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<DecodedImage, &'static str> {
        crate_image::decode(bytes, max_alloc, image::ImageFormat::Jpeg)
    }
}
