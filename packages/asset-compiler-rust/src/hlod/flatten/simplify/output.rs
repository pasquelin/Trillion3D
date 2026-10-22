//! The simplified actor's mesh and atlas as the builder hands them over: the mesh's positions and
//! normals back in our frame (`in_our_frame`), the flat mesh (`flat`) and the atlas (`atlas`).
use super::proxy::Proxy;
use super::transfer::Transferred;
use crate::hlod::flatten::bake::appearance::tone;
use crate::hlod::flatten::bake::{Emission, Maps};
use crate::hlod::flatten::units::{from_frame, swap_axes};
use crate::hlod::flatten::uv::raster::{EMPTY, SAMPLED};
use crate::hlod::flatten::{Atlas, Flat, Sides};

/// `proxy`'s vertex positions and normals in our frame: metres, `y` and `z` exchanged back.
pub(super) fn in_our_frame(proxy: &Proxy) -> (Vec<[f32; 3]>, Vec<[f32; 3]>) {
    (
        proxy.points.iter().map(|&p| from_frame(p)).collect(),
        proxy.normals.iter().map(|&n| swap_axes(n)).collect(),
    )
}

/// A mesh's vertex positions, normals and tangents.
type FlatVertices = (Vec<[f32; 3]>, Vec<[f32; 3]>, Vec<[f32; 4]>);

/// The actor's flat mesh: `proxy`'s triangles and atlas coordinates over its vertices' positions,
/// normals and tangents in our frame, and `colours`, four floats a vertex, empty where the layer
/// carries none.
pub(super) fn flat(
    proxy: Proxy,
    (points, normals, tangents): FlatVertices,
    colours: Vec<f32>,
) -> Flat {
    Flat {
        positions: points.into_iter().flatten().collect(),
        normals: normals.into_iter().flatten().collect(),
        uvs: proxy.uvs.into_iter().flatten().collect(),
        tangents: tangents.into_iter().flatten().collect(),
        colours,
        indices: proxy.indices,
    }
}

/// `pixels`, an RGBA8 image `*side` texels square, as one texel when every texel is alike, `*side`
/// then 1: the bytes are compared first, and nothing is copied for an image that holds more.
fn reduced(pixels: Vec<u8>, side: &mut usize) -> Vec<u8> {
    match pixels.as_chunks::<4>().0.split_first() {
        Some((first, rest)) if !rest.is_empty() && rest.iter().all(|texel| texel == first) => {
            *side = 1;
            first.to_vec()
        }
        _ => pixels,
    }
}

/// The actor's atlas: the images `transferred` made, each at its own of `sides` — one texel where
/// it holds one value (`reduced`) —, the tones the base image's sampled texels hold — before the
/// empty ones are counted and after —, the maps `maps` bakes: the specular riding the
/// metal-roughness map's red channel, the emission a map held over `strength`, the coverage the
/// base image's alpha; and whether the material draws both faces.
pub(super) fn atlas(
    transferred: Transferred,
    (mut sides, maps, strength): (Sides, Maps, f32),
    double_sided: bool,
) -> Atlas {
    let Transferred {
        base,
        normal,
        metal_rough,
        emission,
        occupancy,
    } = transferred;
    let tones = [
        tone(&base, &occupancy, &[SAMPLED]),
        tone(&base, &occupancy, &[SAMPLED, EMPTY]),
    ];
    let base = reduced(base, &mut sides.base);
    let normal = normal.map(|image| reduced(image, &mut sides.normal));
    let metal_rough = metal_rough.map(|image| reduced(image, &mut sides.metal_rough));
    let emission = emission.map(|image| Emission {
        image: reduced(image, &mut sides.emission),
        strength,
    });
    Atlas {
        sides,
        tone: tones,
        base,
        normal,
        metal_rough,
        specular: maps.specular,
        emission,
        occlusion: None,
        anisotropy: None,
        coverage: maps.coverage(),
        double_sided,
    }
}
