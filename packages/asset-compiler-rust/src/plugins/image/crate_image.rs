//! Socle des pilotes servis par la crate `image`, dont les features sont déclarées une par une dans
//! `Cargo.toml` : un format absent des features ne se décode pas, même si ses octets se devinent.
//!
//! Le format est imposé par le pilote appelant, jamais deviné ici : c'est le registre qui a désigné
//! le pilote, et lui seul décide de ce qu'il accepte.
use super::DecodedImage;

pub(super) fn decode(
    bytes: &[u8],
    max_alloc: u64,
    format: image::ImageFormat,
) -> std::result::Result<DecodedImage, &'static str> {
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes));
    reader.set_format(format);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(max_alloc);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|_| "image-decode-failed")?;
    if decoded.width() == 0 || decoded.height() == 0 {
        return Err("image-empty");
    }
    Ok(DecodedImage::Rgba8(decoded.to_rgba8()))
}
