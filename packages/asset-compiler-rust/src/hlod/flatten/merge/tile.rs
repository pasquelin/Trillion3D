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
use super::smear::{Image, BACKGROUND};
use crate::hlod::flatten::bake::gpu::{bake_tile, Laid, Tile};
use crate::hlod::flatten::bake::sources::{Library, Piece, Sources};
use crate::hlod::flatten::bake::Maps;
use trillion3d_math::vector::vec2::{barycentric, double_area};
use trillion3d_math::vector::vecn::{add, scale, sub};
use trillion3d_page_codec::proxy::bvh::Node;
mod behind;
mod frame;
mod targets;
pub(in crate::hlod) use behind::Behind;
pub(in crate::hlod) use frame::cotangent;
pub(in crate::hlod) use targets::Targets;
use targets::{held, place};

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

/// The triangles `coordinates` lays in the entry's image, each with its slot among the scene's
/// sources and the steps of its weights.
fn laid_triangles(
    coordinates: &[[[f64; 2]; 3]],
    steps: &[Steps],
    slots: Option<&[usize]>,
) -> Vec<Laid> {
    (coordinates.iter().zip(steps).enumerate())
        .map(|(triangle, (&[a, b, c], &steps))| {
            let slot = slots.map_or(triangle, |slots| slots[triangle]);
            (slot, [steps[0], steps[1], sub(b, a), sub(c, a)])
        })
        .collect()
}

/// The entry `read` — every triangle of its traced mesh, in order, each laid at its corners'
/// texture coordinates `coordinates` in the unit square — baked `size` texels square into
/// `targets`, the images `maps` names beside the base colour, the chains `library` holds read on
/// the GPU, a translucent texel over what lies behind it where the entry is read among the merged
/// mesh (`Read::Behind`). The texels the entry covers, and its emission strength: the largest
/// channel of emission any of them holds.
fn baked_into(
    read: Read<'_>,
    coordinates: &[[[f64; 2]; 3]],
    (size, maps): (usize, Maps),
    library: &Library,
    targets: &mut Targets,
) -> crate::Result<(Vec<[u32; 4]>, f32)> {
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
    let laid = laid_triangles(coordinates, &steps, slots);
    let mut strength = 0.0f32;
    let mut write = |sample: [u32; 4], tile: &Tile| {
        let emission = targets.put(place(sample, size), tile, maps);
        for channel in emission.into_iter().flatten() {
            strength = strength.max(channel);
        }
    };
    let rows = std::slice::from_ref(&texels);
    let scene = (library, maps, behind);
    bake_tile((sources, nodes), &laid, scene, rows, &mut write)?;
    Ok((texels, strength))
}

/// The entry `read` baked `size` texels square into images of its own (`baked_into`), its emission
/// held over its own strength.
pub(in crate::hlod) fn baked(
    read: Read<'_>,
    coordinates: &[[[f64; 2]; 3]],
    (size, maps): (usize, Maps),
    library: &Library,
) -> crate::Result<Baked> {
    let blank = || Image::background(size, size);
    let mut base = blank();
    let mut normal = maps.normal.then(blank);
    let mut metal_rough = maps.metal_rough().then(blank);
    let mut occlusion = maps.occlusion.then(blank);
    let mut anisotropy = maps.anisotropic().then(blank);
    let mut emitted = maps.emissive.then(|| vec![[0.0f32; 3]; size * size]);
    let mut targets = Targets {
        base: &mut base,
        normal: normal.as_mut(),
        metal_rough: metal_rough.as_mut(),
        occlusion: occlusion.as_mut(),
        anisotropy: anisotropy.as_mut(),
        emitted: emitted.as_deref_mut(),
        masked: false,
    };
    let (texels, strength) = baked_into(read, coordinates, (size, maps), library, &mut targets)?;
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

/// The atlas an entry is baked into in place, shared by the entries: its images and the emission
/// of every texel in linear (`Targets`), and the emission image, in sRGB, held over each entry's
/// own strength.
pub(in crate::hlod) struct Shared<'a> {
    pub targets: Targets<'a>,
    pub emission: Option<&'a mut Image>,
}

impl Shared<'_> {
    /// The emission of the texels `texels` (`covered`, `size` texels square) held over `strength`,
    /// the entry's own, written to the emission image where it is not the background's; the places
    /// written.
    pub(in crate::hlod) fn held_over(
        &mut self,
        texels: &[[u32; 4]],
        size: usize,
        strength: f32,
    ) -> Vec<usize> {
        let (Some(image), Some(linear)) = (self.emission.as_mut(), self.targets.emitted.as_ref())
        else {
            return Vec::new();
        };
        let mut wrote = Vec::new();
        for &sample in texels {
            let at = place(sample, size);
            let value = held(linear[at], strength);
            if value != BACKGROUND {
                image.texels[at] = value;
                wrote.push(at);
            }
        }
        wrote
    }
}

/// The entry `read` baked straight into the atlas `shared` (`baked_into`, masked): its texels are
/// written where a triangle covers them, nothing else of the atlas is touched or scanned, and its
/// emission, held over its own strength, is written to the emission image where it is not the
/// background's. The emission strength of the entry, and the places of the emission texels it
/// wrote.
pub(in crate::hlod) fn baked_in(
    read: Read<'_>,
    coordinates: &[[[f64; 2]; 3]],
    (size, maps): (usize, Maps),
    library: &Library,
    shared: &mut Shared,
) -> crate::Result<(f32, Vec<usize>)> {
    let targets = &mut shared.targets;
    let (texels, strength) = baked_into(read, coordinates, (size, maps), library, targets)?;
    Ok((strength, shared.held_over(&texels, size, strength)))
}
