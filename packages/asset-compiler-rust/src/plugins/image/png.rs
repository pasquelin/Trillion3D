//! Pilote PNG, standard W3C, décodé sans perte par la crate `image` (feature `png`).
use super::{crate_image, DecodedImage, ImageDecoder, Plugin};

pub(super) static PNG: Png = Png;
pub(super) struct Png;

impl Plugin for Png {
    fn name(&self) -> &'static str {
        "png"
    }
    fn version(&self) -> &'static str {
        "png-image-0.25"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["png"]
    }
}

impl ImageDecoder for Png {
    fn mime(&self) -> &'static str {
        "image/png"
    }
    /// La signature de huit octets que tout PNG porte en tête.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(b"\x89PNG\r\n\x1a\n")
    }
    fn decode(
        &self,
        bytes: &[u8],
        max_alloc: u64,
    ) -> std::result::Result<DecodedImage, &'static str> {
        crate_image::decode(bytes, max_alloc, image::ImageFormat::Png)
    }
}
