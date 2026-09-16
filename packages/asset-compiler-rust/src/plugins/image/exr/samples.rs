//! Les échantillons du seul calque d'un OpenEXR, et l'alpha droit que le contrat demande.
//!
//! Ce module ne juge rien : le sous-ensemble a déjà été vérifié par `exr.rs`, qui n'appelle celui-ci
//! qu'une fois la taille connue et le plafond d'allocation appliqué. Il lit les quatre canaux,
//! vérifie que la surface rendue est celle qui était annoncée, puis ramène les échantillons à un
//! alpha droit.
use super::{DecodedImage, ImageDecoded, Transfer, UNREADABLE};
use ::exr::image::RgbaChannels;
use ::exr::math::Vec2;
use ::exr::prelude::traits::{read, ReadChannels, ReadLayers};

/// Les pixels du seul calque, à son plus grand niveau de résolution, rangés ligne du haut d'abord.
/// Un fichier sans canal `A` rend un alpha opaque, comme le prescrit la spécification. La lecture
/// est séquentielle : le compilateur borne ses propres fils, un décodeur de texture ne lui en prend
/// pas d'autres dans le dos.
pub(super) fn read_all(
    bytes: &[u8],
    width: u32,
    height: u32,
) -> std::result::Result<ImageDecoded, &'static str> {
    let stride = width as usize;
    let image = read()
        .no_deep_data()
        .largest_resolution_level()
        .rgba_channels(
            move |size: Vec2<usize>, _: &RgbaChannels| vec![0.0_f32; size.area() * 4],
            move |data: &mut Vec<f32>, at: Vec2<usize>, (r, g, b, a): (f32, f32, f32, f32)| {
                let base = (at.y() * stride + at.x()) * 4;
                if let Some(pixel) = data.get_mut(base..base + 4) {
                    pixel.copy_from_slice(&[r, g, b, a]);
                }
            },
        )
        .first_valid_layer()
        .all_attributes()
        .non_parallel()
        .from_buffered(std::io::Cursor::new(bytes))
        .map_err(|_| UNREADABLE)?;
    let mut data = image.layer_data.channel_data.pixels;
    if data.len() != stride * height as usize * 4 {
        return Err(UNREADABLE);
    }
    straight(&mut data);
    Ok(ImageDecoded::new(
        DecodedImage::RgbaF32 {
            width,
            height,
            data,
        },
        Transfer::Linear,
    ))
}

/// Les échantillons associés ramenés à un alpha droit, pixel par pixel et en place. Un alpha de un
/// laisse le pixel exactement tel quel — la division est neutre —, et un alpha nul ou négatif ne
/// divise rien du tout : c'est la seule valeur sous laquelle la couleur droite n'existe pas.
fn straight(data: &mut [f32]) {
    for pixel in data.as_chunks_mut::<4>().0 {
        let alpha = pixel[3];
        if alpha <= 0.0 || alpha == 1.0 {
            continue;
        }
        for component in pixel.iter_mut().take(3) {
            *component /= alpha;
        }
    }
}
