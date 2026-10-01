//! AVIF container (MIAF) and AV1 pixels, decoded without re-encoding by avif-decode/rav1d.
//! Eight-bit still images retain their channel precision. Higher depths and animations are
//! named refusals, like the existing PNG/WebP contracts, never silently reduced.
use super::{surface_budget, DecodedImage, ImageDecoded, ImageDecoder, Plugin};

mod associations;
mod properties;

pub(super) static AVIF: Avif = Avif;
pub(super) struct Avif;
const FAILED: &str = "image-decode-failed";

impl Plugin for Avif {
    fn name(&self) -> &'static str {
        "avif"
    }
    fn version(&self) -> &'static str {
        "avif-decode-3.0.0-still-depth8-primary-srgb-1"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["avif"]
    }
}

impl ImageDecoder for Avif {
    fn mime(&self) -> &'static str {
        "image/avif"
    }
    fn accepts_head(&self, head: &[u8]) -> bool {
        if head.get(4..8) != Some(b"ftyp") {
            return false;
        }
        let size = u32::from_be_bytes(head[..4].try_into().unwrap()) as usize;
        if size < 16 {
            return false;
        }
        let brands = &head[..head.len().min(size)];
        brands
            .get(8..12)
            .is_some_and(|v| v == b"avif" || v == b"avis")
            || brands.get(16..).is_some_and(|v| {
                v.as_chunks::<4>()
                    .0
                    .iter()
                    .any(|v| v == b"avif" || v == b"avis")
            })
    }
    fn dimensions(&self, bytes: &[u8]) -> Result<(u32, u32), &'static str> {
        dimensions(bytes)
    }
    fn expanded_payload_bytes(&self, bytes: &[u8]) -> Result<usize, &'static str> {
        // The demuxer holds a copy of the coded primary/alpha items during decoding.
        Ok(bytes.len())
    }
    fn decode(&self, bytes: &[u8], max_alloc: u64) -> Result<ImageDecoded, &'static str> {
        let (transfer, notes) = properties::read(bytes)?;
        let (width, height) = dimensions(bytes)?;
        surface_budget(width, height, 4, max_alloc, "image-too-large")?;
        let decoded = avif_decode::Decoder::from_avif(bytes)
            .map_err(|_| FAILED)?
            .to_image()
            .map_err(|_| FAILED)?;
        let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
        let size = match decoded {
            avif_decode::Image::Rgb8(image) => {
                let (pixels, w, h) = image.into_contiguous_buf();
                for p in pixels {
                    rgba.extend_from_slice(&[p.r, p.g, p.b, 255]);
                }
                (w, h)
            }
            avif_decode::Image::Rgba8(image) => {
                let (pixels, w, h) = image.into_contiguous_buf();
                for p in pixels {
                    rgba.extend_from_slice(&[p.r, p.g, p.b, p.a]);
                }
                (w, h)
            }
            avif_decode::Image::Gray8(image) => {
                let (pixels, w, h) = image.into_contiguous_buf();
                for p in pixels {
                    rgba.extend_from_slice(&[p.value(), p.value(), p.value(), 255]);
                }
                (w, h)
            }
            _ => return Err("image-depth-unsupported"),
        };
        if size != (width as usize, height as usize) {
            return Err(FAILED);
        }
        let pixels = image::RgbaImage::from_raw(width, height, rgba).ok_or(FAILED)?;
        Ok(ImageDecoded::new(DecodedImage::Rgba8(pixels), transfer).with_notes(notes))
    }
}

fn dimensions(bytes: &[u8]) -> Result<(u32, u32), &'static str> {
    let parsed = avif_parse::read_avif(&mut &bytes[..]).map_err(|_| FAILED)?;
    let color = parsed.primary_item_metadata().map_err(|_| FAILED)?;
    if !color.still_picture {
        return Err("image-animation-unsupported");
    }
    if color.bit_depth != 8 {
        return Err("image-depth-unsupported");
    }
    let size = (color.max_frame_width.get(), color.max_frame_height.get());
    if let Some(alpha) = parsed.alpha_item_metadata().map_err(|_| FAILED)? {
        if !alpha.still_picture {
            return Err("image-animation-unsupported");
        }
        if alpha.bit_depth != 8 {
            return Err("image-depth-unsupported");
        }
        if (alpha.max_frame_width.get(), alpha.max_frame_height.get()) != size {
            return Err(FAILED);
        }
    }
    Ok(size)
}
