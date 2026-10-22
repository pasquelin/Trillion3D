//! One entry of the merged atlas baked into its own images, as a material is rendered into a
//! tile: the entry's triangles laid out at their texture coordinates in a square of `size`
//! texels, each texel whose centre a triangle covers — the first that covers it — reading that
//! triangle's material once, at the centre, every texture filtered over the one texel's
//! footprint carried onto it (the level whose texel the footprint's longer side spans, two levels
//! blended, each texture wrapped as its sampler wraps it). A texel no triangle covers keeps the
//! background (`smear.rs`). The CPU decides which texel a triangle covers (`covered`), exact and
//! cheap; the GPU reads the material at each, in the one program an approximated shell's atlas
//! reads its sources with (`bake::gpu`, `gpu/tile.wgsl`, `gpu/shade.wgsl`'s `shade`): a texel's
//! bytes follow the GPU's arithmetic, two GPUs may part by a unit in a byte.
//!
//! What a texel holds, as the flattened material carries it (`../bake.rs`), each map where the
//! layer's maps bake it (`bake::Maps`): the base colour — the material's factor, its texture and
//! the vertex colour —, sRGB, its alpha the opacity or the mask where the layer bakes either; the
//! normal the material gives — the vertex normal bent by its normal map over the triangle's
//! cotangent frame —, written in the frame the engine rebuilds for the merged mesh from these
//! texture coordinates (`gpu/tile.wgsl`'s `tangent_space`, `cluster/cotangentFrameWgsl.ts`), so a
//! quad's texel holds the normal map's own value; the roughness and metallic, the factors times
//! the metal-roughness map (glTF's layout, roughness in G, metallic in B), a channel not baked
//! its constant, and the specular in the first channel where it is baked; the emission, the
//! occlusion and the anisotropy, each an image of its own.
//!
//! A translucent part's texel, where the layer sees it through (`Maps::translucency`), holds its
//! base colour, roughness and metallic laid over what lies behind it (`bake::seen`): the merged
//! mesh's parts the ray from the texel's point inward along its vertex normal meets, each read over
//! the texel's footprint carried along the ray onto it, front to back until an opaque one
//! (`Behind`, `behind.rs`, `gpu/tile.wgsl`'s `seen_behind`); its normal its own, and its alpha
//! one, the composite being opaque.
use super::smear::Image;
use crate::hlod::flatten::bake::gpu::{bake_tile, Laid, Tile};
use crate::hlod::flatten::bake::sources::{Library, Piece, Sources};
use crate::hlod::flatten::bake::{Maps, METALLIC, ROUGHNESS};
use crate::texture::linear_to_srgb;
use trillion3d_math::scalar::unit_to_byte;
use trillion3d_math::vector::vec2::{barycentric, double_area};
use trillion3d_math::vector::vecn::{add, scale, sub};
use trillion3d_page_codec::proxy::bvh::Node;
mod behind;
mod frame;
pub(in crate::hlod) use behind::Behind;
pub(in crate::hlod) use frame::cotangent;

/// One entry's images, each `size` texels square: base colour, and the normal map, the
/// metal-roughness map, the emission map, the occlusion map and the anisotropy map where the
/// layer's maps bake them (`bake::Maps`); the emission map's strength, the largest channel of
/// emission any of its texels holds, which its texels are held over — an image holds its colours
/// on the unit interval — and zero where nothing emits.
pub(in crate::hlod) struct Baked {
    pub base: Image,
    pub normal: Option<Image>,
    pub metal_rough: Option<Image>,
    pub emission: Option<Image>,
    pub emission_strength: f32,
    pub occlusion: Option<Image>,
    pub anisotropy: Option<Image>,
}

/// What an entry's texels read: its own sources, nothing lying behind them (`Own`); or, where it
/// is seen through, every part of the merged mesh (`Behind`), the entry's triangles among them at
/// `slots`, in the order of the entry's sources'.
pub(in crate::hlod) enum Read<'a> {
    Own(&'a Sources),
    Behind(&'a Behind, Vec<usize>),
}

impl Read<'_> {
    /// What the entry made of the parts `members` reads, handed to `with`: every part of the
    /// merged mesh where it is seen through (`behind`, the entry's triangles among them), else its
    /// own sources, the pieces `piece_of` gives for `members`.
    pub(in crate::hlod) fn of<'p, R>(
        behind: Option<&Behind>,
        members: &[usize],
        piece_of: impl Fn(usize) -> Piece<'p>,
        library: &Library,
        with: impl FnOnce(Read<'_>) -> R,
    ) -> R {
        match behind {
            Some(behind) => with(Read::Behind(behind, behind.slots(members.iter().copied()))),
            None => {
                let pieces: Vec<Piece> = members.iter().map(|&k| piece_of(k)).collect();
                with(Read::Own(&Sources::of(&pieces, library)))
            }
        }
    }
}

/// A triangle's second and third weights' steps across one texel along `x` then `y`.
type Steps = [[f64; 2]; 2];

/// The texels of a `size` square the triangles at `coordinates` cover, each by the first that
/// covers its centre, as the GPU reads them: per texel its column and row (`x | y << 16`), its
/// triangle's slot among the scene's sources (`slots`, the triangle's own rank where the sources
/// are the entry's) and its second and third weights' bits; and each triangle's steps.
fn covered(
    coordinates: &[[[f64; 2]; 3]],
    size: usize,
    slots: Option<&[usize]>,
) -> (Vec<[u32; 4]>, Vec<Steps>) {
    let mut taken = vec![false; size * size];
    let mut texels: Vec<[u32; 4]> = Vec::new();
    let mut all = Vec::with_capacity(coordinates.len());
    for (triangle, corners) in coordinates.iter().enumerate() {
        let [a, b, c] = corners.map(|uv| scale(uv, size as f64));
        let area = double_area(a, b, c);
        let flat = area.abs() < 1e-300 || !area.is_finite();
        let steps = match flat {
            true => [[0.0; 2]; 2],
            false => [[1.0, 0.0], [0.0, 1.0]].map(|e| barycentric(a, b, c, add(a, e), area)),
        };
        all.push(steps);
        let low = [0, 1].map(|k| (a[k].min(b[k]).min(c[k]) - 0.5).floor().max(0.0) as usize);
        let high = [0, 1].map(|k| {
            (a[k].max(b[k]).max(c[k]) - 0.5)
                .ceil()
                .min(size as f64 - 1.0)
        });
        if flat || high[0] < 0.0 || high[1] < 0.0 {
            continue;
        }
        let slot = slots.map_or(triangle, |slots| slots[triangle]) as u32;
        for y in low[1]..=high[1] as usize {
            for x in low[0]..=high[0] as usize {
                if taken[y * size + x] {
                    continue;
                }
                let at = barycentric(a, b, c, [x as f64 + 0.5, y as f64 + 0.5], area);
                if at[0] >= 0.0 && at[1] >= 0.0 && at[0] + at[1] <= 1.0 {
                    taken[y * size + x] = true;
                    let weights = at.map(|w| (w as f32).to_bits());
                    texels.push([(x as u32) | (y as u32) << 16, slot, weights[0], weights[1]]);
                }
            }
        }
    }
    (texels, all)
}

/// The place in an image `size` texels square of a texel `sample` names (`covered`).
fn place(sample: [u32; 4], size: usize) -> usize {
    (sample[0] >> 16) as usize * size + (sample[0] & 0xffff) as usize
}

/// The metal-roughness texel a tile's word holds, as `maps` bakes it: the specular where baked,
/// else zero; the roughness and the metallic where baked, else their constants
/// (`bake::ROUGHNESS`, `bake::METALLIC`).
fn metal_rough_of(word: u32, maps: Maps) -> [u8; 4] {
    let [specular, rough, metal, _] = word.to_le_bytes();
    [
        if maps.specular { specular } else { 0 },
        if maps.roughness {
            rough
        } else {
            unit_to_byte(ROUGHNESS)
        },
        if maps.metallic {
            metal
        } else {
            unit_to_byte(METALLIC)
        },
        255,
    ]
}

/// The anisotropy texel a tile's word holds, as `maps` bakes it: the direction in its first two
/// channels, the tangent's — along `u` — where the layer does not bake the tangent, and the
/// strength in its third, zero where it does not bake the anisotropy.
fn anisotropy_of(word: u32, maps: Maps) -> [u8; 4] {
    let [x, y, strength, _] = word.to_le_bytes();
    let [x, y] = match maps.tangent {
        true => [x, y],
        false => [unit_to_byte(1.0), unit_to_byte(0.5)],
    };
    [x, y, if maps.anisotropy { strength } else { 0 }, 255]
}

/// The emission texel `emission` over the `strength` it is held to, opaque, in sRGB: black where
/// nothing emits.
fn held(emission: [f32; 3], strength: f32) -> [u8; 4] {
    let share = if strength > 0.0 { 1.0 / strength } else { 0.0 };
    let [r, g, b] = emission.map(|c| linear_to_srgb(c * share));
    [r, g, b, 255]
}

/// The entry `read` — every triangle of its traced mesh, in order, each laid at its corners'
/// texture coordinates `coordinates` in the unit square — baked `size` texels square, the images
/// `maps` names beside the base colour, the chains `library` holds read on the GPU, a translucent
/// texel over what lies behind it where the entry is read among the merged mesh (`Read::Behind`).
pub(in crate::hlod) fn baked(
    read: Read<'_>,
    coordinates: &[[[f64; 2]; 3]],
    (size, maps): (usize, Maps),
    library: &Library,
) -> crate::Result<Baked> {
    let behind = matches!(read, Read::Behind(..));
    let no_nodes: &[Node] = &[];
    let (sources, nodes, slots) = match &read {
        Read::Own(sources) => (*sources, no_nodes, None),
        Read::Behind(merged, slots) => (
            &merged.sources,
            merged.nodes.as_slice(),
            Some(slots.as_slice()),
        ),
    };
    let (texels, steps) = covered(coordinates, size, slots);
    let laid: Vec<Laid> = (coordinates.iter().zip(&steps).enumerate())
        .map(|(triangle, (&[a, b, c], &steps))| {
            let slot = slots.map_or(triangle, |slots| slots[triangle]);
            (slot, [steps[0], steps[1], sub(b, a), sub(c, a)])
        })
        .collect();
    let blank = || Image::background(size, size);
    let mut base = blank();
    let mut normal = maps.normal.then(blank);
    let mut metal_rough = maps.metal_rough().then(blank);
    let mut occlusion = maps.occlusion.then(blank);
    let mut anisotropy = maps.anisotropic().then(blank);
    let mut emitted = maps.emissive.then(|| vec![[0.0f32; 3]; size * size]);
    let mut strength = 0.0f32;
    let mut write = |sample: [u32; 4], tile: &Tile| {
        let at = place(sample, size);
        base.texels[at] = tile[0].to_le_bytes();
        if let Some(image) = normal.as_mut() {
            image.texels[at] = tile[1].to_le_bytes();
        }
        if let Some(image) = metal_rough.as_mut() {
            image.texels[at] = metal_rough_of(tile[2], maps);
        }
        if let Some(image) = occlusion.as_mut() {
            image.texels[at] = tile[3].to_le_bytes();
        }
        if let Some(image) = anisotropy.as_mut() {
            image.texels[at] = anisotropy_of(tile[4], maps);
        }
        if let Some(emitted) = emitted.as_mut() {
            let emission = [tile[5], tile[6], tile[7]].map(f32::from_bits);
            emitted[at] = emission;
            strength = emission.into_iter().fold(strength, f32::max);
        }
    };
    let rows = std::slice::from_ref(&texels);
    bake_tile(
        (sources, nodes),
        &laid,
        (library, maps, behind),
        rows,
        &mut write,
    )?;
    let emission = emitted.map(|linear| {
        let mut image = blank();
        for &sample in &texels {
            let at = place(sample, size);
            image.texels[at] = held(linear[at], strength);
        }
        image
    });
    Ok(Baked {
        base,
        normal,
        metal_rough,
        emission,
        emission_strength: strength,
        occlusion,
        anisotropy,
    })
}
