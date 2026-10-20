//! The unique meshes, the approximated and baked layers, and their bounds.
use super::{
    approximate, bake, first_seen, layer_settings, millis, pack, pieces, reach, sources, step,
    tree, unwrap, Built, Flat, Library, Made, Mesh, Object, Placed, StageMs, Stages,
};
use crate::HlodLayer;

/// A mesh given unique texture coordinates and vertices split by them: `points` welded,
/// `triangles` over them, `normals` per corner; why the packer found no layout otherwise.
pub(super) fn unique(
    points: &[[f64; 3]],
    triangles: &[[usize; 3]],
    normals: &[[f32; 3]],
    texture_size: usize,
) -> Result<Flat, &'static str> {
    let topology = unwrap::Topology { points, triangles };
    let (mut corners, islands) = unwrap::unwrap(&topology);
    // The islands packed on a grid of the atlas's compressed blocks, a packing texel one block: each
    // chart lands on whole blocks, its dilation keeping a block between two, so no block holds two
    // charts and its endpoints serve one. The packer fails only on islands of no area, which no
    // square can scale to fit: the actor is then reported, never published with coordinates
    // outside the square.
    let blocks = texture_size as u32 / crate::plugins::image::blocks::BLOCK_SIDE;
    if !pack::pack(&mut corners, &islands, blocks) {
        return Err("the packer found no layout");
    }
    // Each corner's vertex: its point, its normal's and its coordinates' bits, numbered in the order
    // corners first name them (`first_seen`).
    use rayon::prelude::*;
    let keys: Vec<(usize, [u32; 3], [u32; 2])> = (corners.par_iter().enumerate())
        .map(|(corner, uv)| {
            let uv = uv.map(|x| (x as f32).to_bits());
            (
                triangles[corner / 3][corner % 3],
                normals[corner].map(f32::to_bits),
                uv,
            )
        })
        .collect();
    drop(corners);
    let (vertices, indices) = first_seen::first_seen(keys);
    let mut flat = Flat {
        positions: Vec::with_capacity(vertices.len() * 3),
        normals: Vec::with_capacity(vertices.len() * 3),
        uvs: Vec::with_capacity(vertices.len() * 2),
        indices,
    };
    for (v, n, uv) in vertices {
        flat.positions.extend(points[v].map(|x| x as f32));
        flat.normals.extend(n.map(f32::from_bits));
        flat.uvs.extend(uv.map(f32::from_bits));
    }
    Ok(flat)
}

/// The bounds of `meshes`.
pub(super) fn bounds_of(meshes: &[Mesh]) -> ([f64; 3], [f64; 3]) {
    use trillion3d_math::aabb::{aabb_of, aabb_of_boxes};
    aabb_of_boxes(meshes.iter().map(|(positions, _)| {
        aabb_of(
            positions
                .as_chunks::<3>()
                .0
                .iter()
                .map(|p| p.map(f64::from)),
        )
    }))
}

/// An approximated layer's actor first seen from `distance`: the approximation's shell of `meshes`
/// (`approximate`) at the layer's accuracy within its deviation (`layer_settings`), given unique
/// texture coordinates and its sources read onto it (`baked`).
/// `Err` with the reason the shell could not be made and the triangles of its steps done.
pub(super) fn approximated<P: std::borrow::Borrow<[Object]>>(
    layer: &HlodLayer,
    meshes: &[Mesh],
    sources: (impl FnOnce() -> P, &Library),
    distance: f64,
) -> Built {
    let settings = layer_settings(layer, bounds_of(meshes), distance);
    let shell = approximate::approximate(meshes, settings.accuracy, settings.deviation)?;
    baked(
        (shell.positions, shell.indices, shell.normals),
        sources,
        settings.texture_size,
        (Some(shell.closed), shell.stages, shell.ms),
    )
}

/// A shell's actor: `positions` and `indices`, one normal per corner, given unique texture
/// coordinates of a `texture_size` atlas (`unique`), the objects `placed` gives — with their
/// materials, called only once the shell stands and dropped once traced — read onto it
/// (`bake::project`, each triangle within the farthest it lies from them, `reach`). `closed` the mesh the
/// layer above reads, the shell itself when `None`; `stages` its triangles after each step, `ms`
/// the milliseconds of the steps before, given the unwrap's and the bake's here. `Err` with the
/// reason it could not be unwrapped.
pub(super) fn baked<P: std::borrow::Borrow<[Object]>>(
    (positions, indices, normals): (Vec<f32>, Vec<u32>, Vec<[f32; 3]>),
    (placed, library): (impl FnOnce() -> P, &Library),
    texture_size: usize,
    (closed, stages, mut ms): (Option<Placed>, Stages, StageMs),
) -> Built {
    let started = std::time::Instant::now();
    let points: Vec<[f64; 3]> = (positions.as_chunks::<3>().0.iter())
        .map(|p| p.map(f64::from))
        .collect();
    let triangles: Vec<[usize; 3]> = (indices.as_chunks::<3>().0.iter())
        .map(|t| t.map(|v| v as usize))
        .collect();
    let flat = unique(&points, &triangles, &normals, texture_size).map_err(|e| (e, stages))?;
    ms[step::UNWRAP] = millis(started);
    let mut sources = {
        let placed = placed();
        let placed: &[Object] = std::borrow::Borrow::borrow(&placed);
        sources::traceable(&pieces(placed), (library, &Default::default()))
    };
    let started = std::time::Instant::now();
    let (nodes, _) = tree::order_sources(&mut sources);
    let tree = tree::Tree::over(nodes, &sources);
    let reach = reach(&points, &triangles, &tree);
    let atlas = bake::project(&flat, &sources, &tree, texture_size, &reach);
    ms[step::BAKE] = millis(started);
    Ok(Made {
        flat,
        atlas,
        closed: closed.unwrap_or((positions, indices)),
        stages,
        stage_ms: ms,
    })
}
