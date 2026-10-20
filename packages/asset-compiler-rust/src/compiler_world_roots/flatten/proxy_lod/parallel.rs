//! The parallel simplification: the iso-surface cut into 31 then 7 slabs along the source bounds'
//! major axis — a count kept only while the mesh has 10000 triangles per slab —, each slab
//! simplified alone with its cut edges locked (`partition_and_simplify`) and the slabs welded back
//! on their locked vertices (`merge`), each wave keeping the same fraction, then the whole mesh
//! simplified to the target count within the feature cost.
use super::simplifier::{pos_bits, Simplifier, Terminator, Vertex};
use super::PERCENT_TO_RETAIN;
use rayon::prelude::*;
use trillion3d_page_codec::hash::WordMap;

/// A mesh as an array of vertices and a triangle index list.
#[derive(Default)]
pub(super) struct AosMesh {
    pub verts: Vec<Vertex>,
    pub indexes: Vec<u32>,
}

/// The source bounds, single precision.
#[derive(Clone, Copy)]
pub(super) struct Bounds {
    pub min: [f32; 3],
    pub max: [f32; 3],
}

impl Bounds {
    /// The longest axis, the last of them on a tie.
    pub(super) fn major(&self) -> usize {
        let e: [f32; 3] = std::array::from_fn(|k| self.max[k] - self.min[k]);
        let mut r = 0;
        for i in 1..3 {
            if e[i] >= e[r] {
                r = i;
            }
        }
        r
    }
}

/// The mesh replaced by its
/// simplification, normal weights {1, 1, 1}; with `seams`, the boundary locked and the output ids
/// of locked vertices collected.
fn simplify_mesh(terminator: Terminator, mesh: &mut AosMesh, seams: Option<&mut Vec<u32>>) {
    let mut seams = seams;
    if let Some(list) = seams.as_deref_mut() {
        list.clear();
    }
    if mesh.verts.is_empty() || mesh.indexes.is_empty() {
        return;
    }
    let mut simplifier = Simplifier::new(&mesh.verts, &mesh.indexes);
    *mesh = AosMesh::default();
    if seams.is_some() {
        simplifier.set_boundary_locked();
    }
    simplifier.init_costs();
    simplifier.simplify(terminator);
    let (verts, indexes) = simplifier.output(seams);
    *mesh = AosMesh { verts, indexes };
}

/// The mesh cut into `count` slabs along the major axis: a triangle goes to the slab of its lowest corner on the major axis; each slab copies its
/// vertices in the order its triangles first use them.
fn partition(mesh: &AosMesh, bounds: &Bounds, count: usize) -> Vec<AosMesh> {
    let major = bounds.major();
    let min = bounds.min[major];
    let per_length = count as f32 / (bounds.max[major] - min);
    let slabs: Vec<usize> = mesh
        .indexes
        .chunks_exact(3)
        .map(|t| {
            let lowest = t
                .iter()
                .map(|&v| f64::from(mesh.verts[v as usize].pos[major]))
                .fold(f64::INFINITY, f64::min) as f32;
            ((per_length * (lowest - min)).floor() as i32).clamp(0, count as i32 - 1) as usize
        })
        .collect();
    (0..count)
        .into_par_iter()
        .map(|p| {
            let mut out = AosMesh::default();
            let mut local: WordMap<u32, u32> = WordMap::default();
            for (t, tri) in mesh.indexes.chunks_exact(3).enumerate() {
                if slabs[t] != p {
                    continue;
                }
                for &v in tri {
                    let id = *local.entry(v).or_insert_with(|| {
                        out.verts.push(mesh.verts[v as usize]);
                        out.verts.len() as u32 - 1
                    });
                    out.indexes.push(id);
                }
            }
            out
        })
        .collect()
}

/// The slabs welded on their seam vertices: the slabs appended,
/// each seam vertex replaced by the smallest index among the seam vertices at its position, the
/// vertex list compacted in first use order.
fn merge(meshes: Vec<AosMesh>, seams: &[Vec<u32>]) -> AosMesh {
    let mut all = AosMesh::default();
    let mut seam_ids = Vec::new();
    for (mesh, seam) in meshes.into_iter().zip(seams) {
        let offset = all.verts.len() as u32;
        seam_ids.extend(seam.iter().map(|&s| offset + s));
        all.indexes.extend(mesh.indexes.iter().map(|&i| offset + i));
        all.verts.extend(mesh.verts);
    }
    if seam_ids.is_empty() {
        return all;
    }
    let mut smallest: WordMap<[u32; 3], u32> = WordMap::default();
    for &id in &seam_ids {
        let key = pos_bits(all.verts[id as usize].pos);
        let e = smallest.entry(key).or_insert(id);
        *e = (*e).min(id);
    }
    let mut map: Vec<u32> = (0..all.verts.len() as u32).collect();
    for &id in &seam_ids {
        map[id as usize] = smallest[&pos_bits(all.verts[id as usize].pos)];
    }
    let mut out = AosMesh::default();
    let mut compact: WordMap<u32, u32> = WordMap::default();
    for &i in &all.indexes {
        let old = map[i as usize];
        let id = *compact.entry(old).or_insert_with(|| {
            out.verts.push(all.verts[old as usize]);
            out.verts.len() as u32 - 1
        });
        out.indexes.push(id);
    }
    out
}

/// One wave: the mesh cut into `count` slabs, each simplified in parallel to `fraction` of its
/// triangles with its cut edges locked, then welded back.
fn partition_and_simplify(
    bounds: &Bounds,
    fraction: f32,
    max_cost: f32,
    count: usize,
    mesh: &mut AosMesh,
) {
    let mut slabs = partition(mesh, bounds, count);
    *mesh = AosMesh::default();
    let seams: Vec<Vec<u32>> = slabs
        .par_iter_mut()
        .map(|slab| {
            let min_tris = ((slab.indexes.len() / 3) as f32 * fraction).ceil() as i32;
            let mut seams = Vec::new();
            simplify_mesh(Terminator { min_tris, max_cost }, slab, Some(&mut seams));
            seams
        })
        .collect();
    *mesh = merge(slabs, &seams);
}

/// The iso-surface simplified to `PERCENT_TO_RETAIN` of `source_polygons`, the source triangle
/// count, within `max_cost`. The triangles left after the slab waves.
pub(super) fn parallel_simplify(
    bounds: &Bounds,
    source_polygons: usize,
    max_cost: f32,
    mesh: &mut AosMesh,
) -> usize {
    let tris = mesh.indexes.len() / 3;
    if mesh.indexes.len() <= 3 {
        return tris;
    }
    let to_retain = (source_polygons as f32 * PERCENT_TO_RETAIN).ceil() as i32;
    let fraction = to_retain as f32 / tris as f32;
    if fraction >= 1.0 {
        return tris;
    }
    let sequence: Vec<usize> = [31usize, 7]
        .into_iter()
        .filter(|&p| tris >= p * 10000)
        .collect();
    let per_step = (fraction.ln() / (sequence.len() + 1) as f32).exp();
    for count in sequence {
        partition_and_simplify(bounds, per_step, max_cost, count, mesh);
    }
    let waved = mesh.indexes.len() / 3;
    simplify_mesh(
        Terminator {
            min_tris: to_retain,
            max_cost,
        },
        mesh,
        None,
    );
    waved
}
