//! One bake's scene as the compute pass reads it, one buffer of `vec4` words: the shell's frames,
//! the tree over the sources, the sources' corners and attributes in the tree's leaf order, the
//! tree over the shell, the shell's corners in its leaf order and the views; and the surfaces
//! they wear with the chains those read, each chain once however many surfaces
//! read it, how their samplers wrap them and whether they draw both faces. Positions are taken
//! about the sources' centre, so single precision keeps the detail of a cell far from the scene's
//! origin.
use super::super::capture::Views;
use super::super::sources::Sources;
use super::super::tree::{soup, Tree};
use super::super::Flat;
use super::frames::pack_frames;
use super::layout::{HEAD_RECORDS, MAX_DEPTH, NODE_RECORDS, SURFACE_RECORDS};
use crate::hlod::flatten::gpu::layout::NONE;
use crate::hlod::flatten::gpu::pack::{base, check_depth, float, local, pack_links};
use crate::trace::surface::material::{
    Surface, Texels, EMISSION_SLOT, METAL_ROUGH_SLOT, NORMAL_SLOT, SPECULAR_SLOT,
};
use crate::trace::surface::Traceable;
use std::collections::btree_map::{BTreeMap, Entry};
use std::sync::Arc;
use trillion3d_math::geometry::aabb::aabb_of_f32;
use trillion3d_math::vector::vecn::{length, sub};
use trillion3d_page_codec::proxy::bvh::Node;

/// How far a capture's visibility ray starts off the shell, over the shell box's least side: a
/// hundred single-precision zero tolerances, so the ray leaves the triangle it starts on.
const SHELL_OFFSET: f64 = 100.0 * 1e-6;

/// How far past a translucent layer a view's ray goes on (`capture.wgsl`'s `view_pixel`), over
/// the farthest a coordinate it reads lies from the sources' centre — a view's eye, plus the
/// sources' radius —: sixteen single-precision roundings, as two hits that close are one surface
/// (`Traceable::tie`), so a ray leaves the layer it met and the triangles beside it on that pane.
const LAYER_GAP: f64 = 16.0 * f32::EPSILON as f64;

/// The texture slots the bake reads, in the order of a surface's maps and transform rows: base
/// colour, metal-roughness, normal map, emission, specular (`material::SLOTS` ranks).
const READ_SLOTS: [usize; 5] = [
    0,
    METAL_ROUGH_SLOT,
    NORMAL_SLOT,
    EMISSION_SLOT,
    SPECULAR_SLOT,
];

/// A bake's scene: its words; the materials' head (`layout::HEAD_RECORDS`) — its first word, the
/// first texture record, left for the bake to set once the surfaces are counted (`run.rs`), then
/// the view count, the image side and the shell offset's bits; the `vec4` bases of the frames,
/// nodes, corners and attributes — the frames' always zero, as they come first, kept so the
/// shaders address every section alike (`scene.wgsl`'s `bases`); the shell's nodes and corners'
/// and the views' bases; whether a translucent source is seen through, the layer gap's bits
/// (`LAYER_GAP`) and the views' anisotropy clamp —; its surfaces' records, their maps naming the
/// chains by rank in `chains`.
pub(super) struct Scene {
    pub words: Vec<u32>,
    pub head: [[u32; 4]; HEAD_RECORDS],
    pub surfaces: Vec<u32>,
    pub chains: Vec<Arc<Texels>>,
}

/// A capture's views about `origin` (`layout::VIEW_RECORDS`): each one's eye and near plane's
/// distance, its sight and its image's half side on the near plane, its image's right, its
/// image's up.
fn pack_views(out: &mut Vec<u32>, views: &Views, origin: [f64; 3]) {
    for view in &views.views {
        let [sight, right, up] = view.axes;
        out.extend(local(view.origin, origin).map(f32::to_bits));
        out.push(float(views.near));
        out.extend(sight.map(float));
        out.push(float(views.half_side));
        for axis in [right, up] {
            out.extend(axis.map(float));
            out.push(0);
        }
    }
}

/// The tree over `flat`'s triangles about `origin`: its nodes, then its triangles' corners in
/// leaf order (`layout::CORNER_RECORDS`); the `vec4` bases of both.
fn pack_shell(out: &mut Vec<u32>, flat: &Flat, origin: [f64; 3]) -> crate::Result<[u32; 2]> {
    let tree = Tree::from_soup(soup(&flat.positions, &flat.indices));
    check_depth(&tree.nodes, MAX_DEPTH, "the tree over its shell")?;
    let nodes_at = base(out);
    pack_nodes(out, &tree.nodes, origin);
    let corners_at = base(out);
    for slot in 0..tree.triangles.len() / 9 {
        for corner in tree.corners(slot) {
            out.extend(local(corner, origin).map(f32::to_bits));
            out.push(0);
        }
    }
    Ok([nodes_at, corners_at])
}

/// Each node about `origin` (`layout::NODE_RECORDS`): its box, its children padded with `NONE`, a
/// leaf's first slot and count — an empty tree one leaf of none.
fn pack_nodes(out: &mut Vec<u32>, nodes: &[Node], origin: [f64; 3]) {
    if nodes.is_empty() {
        out.extend([0; 8]);
        out.extend([NONE; 4]);
        out.extend([0; 4]);
        return;
    }
    out.reserve(nodes.len() * NODE_RECORDS * 4);
    for node in nodes {
        for bound in [node.low, node.high] {
            out.extend(local(bound.map(f64::from), origin).map(f32::to_bits));
            out.push(0);
        }
        pack_links(out, node);
    }
}

/// Each source triangle's corners about `origin`, the first corner's fourth word its surface's
/// rank (`layout::CORNER_RECORDS`).
fn pack_corners(out: &mut Vec<u32>, sources: &Traceable, origin: [f64; 3]) {
    for t in 0..sources.corners.len() {
        for k in 0..3 {
            let p = crate::trace::tracer::vertex(&sources.world, t, k);
            out.extend(local(p, origin).map(f32::to_bits));
            out.push(if k == 0 { sources.world.tags[t] } else { 0 });
        }
    }
}

/// Each source triangle's attributes (`layout::ATTRIBUTE_RECORDS`): normals, the first's fourth
/// word whether it has them and the second's whether it has colours; both sets' coordinates;
/// colours.
fn pack_attributes(out: &mut Vec<u32>, sources: &Traceable) {
    for corner in &sources.corners {
        let normals = corner.normals.unwrap_or_default();
        for (k, flag) in [corner.normals.is_some(), corner.colours.is_some(), false]
            .into_iter()
            .enumerate()
        {
            out.extend(normals[k * 3..k * 3 + 3].iter().map(|x| x.to_bits()));
            out.push(u32::from(flag));
        }
        let [set0, set1] = &corner.uv;
        out.extend(set0.iter().chain(set1).map(|x| x.to_bits()));
        let colours = corner.colours.unwrap_or([1.0; 12]);
        out.extend(colours.iter().map(|x| x.to_bits()));
    }
}

/// One surface's records (`layout::SURFACE_RECORDS`), its maps named by `chain` and wrapped as
/// `wraps` holds them (`sources::wraps_word`, in `READ_SLOTS` order), drawing both faces when
/// `double_sided`: its factor; its roughness, metallic, normal scale and transmission; its cut; its
/// first three slots' sets and the wraps; its first three maps and whether it draws both faces;
/// two transform rows per slot read; its emission and specular input; its emission and specular
/// maps and their sets.
fn pack_surface(
    out: &mut Vec<u32>,
    (surface, wraps, double_sided): (&Surface, u32, bool),
    chain: &mut dyn FnMut(&Arc<Texels>) -> u32,
) {
    out.extend(surface.factor.map(float));
    let [rough, metal] = surface.rough_metal;
    out.extend([rough, metal, surface.normal_scale, surface.transmission].map(float));
    let (cutoff, factor, cuts) = match surface.cut {
        Some((cutoff, factor)) => (f64::from(cutoff), f64::from(factor), 1.0),
        None => (0.0, 0.0, 0.0),
    };
    let blend = if surface.blend { 1.0 } else { 0.0 };
    out.extend([cutoff, factor, cuts, blend].map(float));
    let sets = READ_SLOTS.map(|slot| surface.sets[slot].min(1) as u32);
    out.extend([sets[0], sets[1], sets[2], wraps]);
    for map in [&surface.colour, &surface.metal_rough, &surface.normal_map] {
        out.push(map.as_ref().map_or(NONE, &mut *chain));
    }
    out.push(u32::from(double_sided));
    for slot in READ_SLOTS {
        let [a, b, c, d, e, f] = surface.transforms[slot];
        out.extend([a, b, c, 0.0].map(float));
        out.extend([d, e, f, 0.0].map(float));
    }
    let [red, green, blue] = surface.emission;
    out.extend([red, green, blue, surface.specular].map(float));
    for map in [&surface.emission_map, &surface.specular_map] {
        out.push(map.as_ref().map_or(NONE, &mut *chain));
    }
    out.extend([sets[3], sets[4]]);
}

impl Scene {
    /// The shell `flat` over `sources`, read through `views` of them, a translucent source seen
    /// through when `seen_through`, their rays walking the tree `nodes` over them.
    pub fn new(
        flat: &Flat,
        sources: &Sources,
        (nodes, views, seen_through): (&[Node], &Views, bool),
    ) -> crate::Result<Self> {
        let Sources {
            mesh: sources,
            wraps,
            double_sided,
        } = sources;
        let origin = sources.centre;
        check_depth(nodes, MAX_DEPTH, "the tree over its sources")?;
        let mut words = Vec::new();
        pack_frames(&mut words, flat, origin);
        let nodes_at = base(&words);
        pack_nodes(&mut words, nodes, origin);
        let corners_at = base(&words);
        pack_corners(&mut words, sources, origin);
        let attributes_at = base(&words);
        pack_attributes(&mut words, sources);
        let [shell_nodes, shell_corners] = pack_shell(&mut words, flat, origin)?;
        let views_at = base(&words);
        pack_views(&mut words, views, origin);
        let (low, high) = aabb_of_f32(flat.positions.as_chunks::<3>().0.iter().copied());
        let least = (0..3)
            .map(|k| f64::from(high[k] - low[k]))
            .fold(f64::MAX, f64::min);
        let offset = float(SHELL_OFFSET * least);
        let eye = (views.views.iter())
            .map(|view| length(sub(view.origin, origin)))
            .fold(0.0, f64::max);
        let gap = float(LAYER_GAP * (eye + sources.radius));
        let head = [
            [0, views.views.len() as u32, views.side as u32, offset],
            [0, nodes_at, corners_at, attributes_at],
            [shell_nodes, shell_corners, views_at, 0],
            [u32::from(seen_through), gap, views.anisotropy as u32, 0],
        ];
        let mut rank: BTreeMap<usize, u32> = BTreeMap::new();
        let mut chains = Vec::new();
        let mut chain = |texels: &Arc<Texels>| match rank.entry(Arc::as_ptr(texels) as usize) {
            Entry::Occupied(at) => *at.get(),
            Entry::Vacant(at) => {
                chains.push(texels.clone());
                *at.insert(chains.len() as u32 - 1)
            }
        };
        let mut surfaces = Vec::with_capacity(sources.surfaces.len() * SURFACE_RECORDS * 4);
        for ((surface, &wraps), &both) in sources.surfaces.iter().zip(wraps).zip(double_sided) {
            pack_surface(&mut surfaces, (surface, wraps, both), &mut chain);
        }
        Ok(Self {
            words,
            head,
            surfaces,
            chains,
        })
    }
}
