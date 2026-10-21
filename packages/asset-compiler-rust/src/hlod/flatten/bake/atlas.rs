//! The atlas of an approximated shell: the texels placed, read on the GPU and written as they
//! return, the gutter, the empty texels and the holes filled, the tones read and held, each image
//! averaged down to its own side (`sized`); what it bakes is the layer's `Maps`.
use super::super::uv::raster::{
    dilate, gutter_source, infill, rasterize, Image, Role, EMPTY, HOLE, SAMPLED,
};
use super::appearance::tone;
use super::capture::Views;
use super::emission;
use super::gpu;
use super::maps::{Coverage, Maps, METALLIC, ROUGHNESS};
use super::sources::{Library, Sources};
use super::{Atlas, Emission, Flat, Sides};
use crate::hlod::options::HlodEmptyTexels;
use trillion3d_math::scalar::unit_to_byte_f32;
use trillion3d_math::vector::vecn::scale;
use trillion3d_page_codec::proxy::bvh::Node;

/// What a texel of the base colour and of the normal map holds where nothing writes it: black, the
/// frame's own normal (tangent-space up).
const BASE: [u8; 4] = [0, 0, 0, 255];
const NORMAL: [u8; 4] = [128, 128, 255, 255];

/// The largest atlas side a capture bakes at before it averages its supersampling down: past it,
/// the capture bakes at the atlas's own side.
const LARGEST_SUPERSAMPLED: usize = 16384;

/// How many times larger per side a `size` atlas is baked for `multisampling` (`captured`): none at
/// 0 or 1, nor where the larger side passes `LARGEST_SUPERSAMPLED`.
pub(crate) fn supersampling(size: usize, multisampling: usize) -> usize {
    match multisampling.max(1) {
        factor if size * factor > LARGEST_SUPERSAMPLED => 1,
        factor => factor,
    }
}

/// The texels of `flat` in a `size` atlas (`raster::rasterize`): each row's interior texels, in
/// order — column and row, triangle, its second and third weights —, and every texel's occupancy.
fn placed(flat: &Flat, size: usize) -> (Vec<Vec<[u32; 4]>>, Vec<u32>) {
    let corners: Vec<[f64; 2]> = (flat.indices.iter())
        .map(|&v| scale(flat.uv(v as usize), size as f64))
        .collect();
    let mut rows: Vec<Vec<[u32; 4]>> = vec![Vec::new(); size];
    let outputs: Vec<(u32, &mut Vec<[u32; 4]>)> = (rows.iter_mut().enumerate())
        .map(|(y, row)| (y as u32, row))
        .collect();
    let place = |(y, row): &mut (u32, &mut Vec<[u32; 4]>), x: usize, t: usize, w: [f64; 3]| {
        let weights = [w[1], w[2]].map(|x| (x as f32).to_bits());
        row.push([x as u32 | *y << 16, t as u32, weights[0], weights[1]]);
    };
    let occupancy = rasterize(size, &corners, outputs, &place);
    (rows, occupancy)
}

/// Each texel's role in the fill of what holds no chart's value with the nearest chart's
/// (`nearestChart`, `raster::dilate`), its gutter copied: a sampled texel and a gutter copy of one
/// a source; a hole left to the infill; an empty texel and a gutter copy of a hole, the missing
/// value, filled — each then marked empty, a value the infill takes.
fn fill_roles(occupancy: &[u32]) -> Vec<Role> {
    (occupancy.iter())
        .map(|&code| match code {
            SAMPLED => Role::Source,
            HOLE => Role::Barred,
            code => match gutter_source(code) {
                Some(from) if occupancy[from] == SAMPLED => Role::Source,
                _ => Role::Open,
            },
        })
        .collect()
}

/// `pixels`, a `side` texels square image, averaged down to `wanted` texels a side in its curve —
/// in linear where it holds sRGB colours (`srgb`) —; as it is where it is that side already.
pub(crate) fn sized(mut pixels: Vec<u8>, (side, wanted): (usize, usize), srgb: bool) -> Vec<u8> {
    match side / wanted {
        1 => pixels,
        factor if srgb => Image::srgb(&mut pixels).reduced(side, factor),
        factor => Image::unit(&mut pixels).reduced(side, factor),
    }
}

/// The approximated shell's atlas, baked `size` texels square, each image then averaged down to
/// its own of `sides` (`HlodAtlasSizing`), `flat` the shell given unique coordinates, read through
/// `views` of `sources` (`gpu/capture.wgsl`, `capture.rs`), their rays walking the tree `nodes`
/// over them, the chains `library` holds read from its pages, `maps` baked beside the base colour,
/// a translucent source as `maps` names (`Maps::translucency`), the whole baked `multisampling`
/// times larger per side — none at 0 or 1, nor past `LARGEST_SUPERSAMPLED` — and averaged down;
/// single-sided, a closed shell drawn on its outer faces alone. As a capture's bake does it: every
/// texel placed (`raster::rasterize`), read, and the images written — a texel no view sees a hole,
/// black, its normal the one a missing sample reads back, a baked roughness, metallic, specular or
/// emission zero —; each gutter texel then a copy of its interior texel as it stands, a hole's
/// too; then the holes filled from every texel around them but a hole and a gutter copy of one —
/// an empty texel feeds its value — (`raster::infill`), on the base colour, the metal-roughness
/// map and the emission, never on the normal map. What holds no chart's value — the empty texels,
/// the gutter copies of holes — as `empty` names: with `black`, left as it is — an empty texel
/// black, the frame's up, zero where a channel is baked —; with `nearestChart`, the nearest
/// chart's on every image, the normal map's too, given before the holes are filled (`fill_roles`,
/// `raster::dilate`), so no black reaches a chart's border, the infill or the averaging down. The
/// specular rides in the metal-roughness map's first channel; the emission is held over its
/// strength (`emission`). Stops when the library's cancel token is raised.
pub(crate) fn captured(
    flat: &Flat,
    (size, sides): (usize, Sides),
    sources: (&Sources, &Library),
    (nodes, views): (&[Node], &Views),
    (maps, multisampling, empty): (Maps, usize, HlodEmptyTexels),
) -> crate::Result<Atlas> {
    let factor = supersampling(size, multisampling);
    let side = size * factor;
    let texels = side * side;
    let (rows, mut occupancy) = placed(flat, side);
    // A channel the map does not bake holds its constant everywhere; a baked one, zero where
    // nothing writes it.
    let [rough_constant, metal_constant] =
        [ROUGHNESS, METALLIC].map(|c| unit_to_byte_f32(c as f32));
    let rough_empty = if maps.roughness { 0 } else { rough_constant };
    let metal_empty = if maps.metallic { 0 } else { metal_constant };
    let empty_metal_rough = [0, rough_empty, metal_empty, 255];
    let mut base = BASE.repeat(texels);
    let mut normal = NORMAL.repeat(texels);
    let mut metal_rough = empty_metal_rough.repeat(texels);
    let mut emitted = maps.emissive.then(|| vec![[0u16; 3]; texels]);
    let mut write = |sample: [u32; 4], [base_word, normal_word, third, pair]: [u32; 4]| {
        let texel = (sample[0] >> 16) as usize * side + (sample[0] & 0xffff) as usize;
        let at = texel * 4..texel * 4 + 4;
        let [b, n] = [base_word, normal_word].map(u32::to_le_bytes);
        normal[at.clone()].copy_from_slice(&[n[0], n[1], n[2], 255]);
        if third & 1 == 0 {
            occupancy[texel] = HOLE;
            return;
        }
        occupancy[texel] = SAMPLED;
        base[at.clone()].copy_from_slice(&[b[0], b[1], b[2], 255]);
        let rough = if maps.roughness { b[3] } else { rough_constant };
        let metal = if maps.metallic { n[3] } else { metal_constant };
        let specular = if maps.specular { (third >> 8) as u8 } else { 0 };
        metal_rough[at].copy_from_slice(&[specular, rough, metal, 255]);
        if let Some(emitted) = emitted.as_mut() {
            emitted[texel] = emission::halves(pair, third);
        }
    };
    let read = (nodes, views, maps.seen_through());
    gpu::bake(flat, sources, read, &rows, &mut write)?;
    drop(rows);
    let read_tone = tone(&base, &occupancy, &[SAMPLED]);
    let (mut emission, strength) = match emitted {
        Some(halves) => {
            let (image, strength) = emission::encoded(&halves, &occupancy);
            (Some(image), strength)
        }
        None => (None, 0.0),
    };
    let mut base_image = Image::srgb(&mut base);
    let mut normal_image = Image::unit(&mut normal);
    let mut metal_rough_image = Image::unit(&mut metal_rough);
    let mut emission_image = emission.as_deref_mut().map(Image::srgb);
    for (to, &code) in occupancy.iter().enumerate() {
        if let Some(from) = gutter_source(code) {
            base_image.copy(from, to);
            normal_image.copy(from, to);
            metal_rough_image.copy(from, to);
            emission_image
                .iter_mut()
                .for_each(|image| image.copy(from, to));
        }
    }
    if empty == HlodEmptyTexels::NearestChart {
        dilate([side; 2], fill_roles(&occupancy), |at, from| {
            base_image.mean(at, from);
            normal_image.mean(at, from);
            metal_rough_image.mean(at, from);
            emission_image
                .iter_mut()
                .for_each(|image| image.mean(at, from));
            occupancy[at] = EMPTY;
            true
        });
    }
    infill(side, &occupancy, |at, from| {
        base_image.mean(at, from);
        metal_rough_image.mean(at, from);
        emission_image
            .iter_mut()
            .for_each(|image| image.mean(at, from));
    });
    drop(emission_image);
    let held_tone = tone(&base, &occupancy, &[SAMPLED, HOLE]);
    // Each image averaged down to its own side: by the supersampling, and by the share of the
    // baked side its sizing gives it.
    let emission = emission.map(|image| Emission {
        image: sized(image, (side, sides.emission), true),
        strength,
    });
    Ok(Atlas {
        sides,
        tone: [read_tone, held_tone],
        base: sized(base, (side, sides.base), true),
        normal: maps
            .normal
            .then(|| sized(normal, (side, sides.normal), false)),
        metal_rough: (maps.metal_rough())
            .then(|| sized(metal_rough, (side, sides.metal_rough), false)),
        specular: maps.specular,
        emission,
        occlusion: None,
        anisotropy: None,
        coverage: Coverage::Opaque,
        double_sided: false,
    })
}
