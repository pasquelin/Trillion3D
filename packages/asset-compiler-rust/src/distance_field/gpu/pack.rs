//! The scene as the kernel reads it, in single precision about the mesh's box centre: the head, the
//! mips' volumes, the rays, the tree's boxed nodes and its triangles in leaf order, each a whole
//! number of `vec4` records (`layout.rs`). Positions and links are packed as the other programs
//! pack them (`flatten/gpu/pack.rs`), its boxes as the shell's queries box theirs
//! (`approximate/gpu/pack.rs`): recomputed from the corners as packed, widened past the rounding.
use super::layout::{DOUBT, HEAD_WORDS, MAX_DEPTH};
use crate::distance_field::grid::MipGrid;
use crate::distance_field::scene::{enough_back_faces, Scene};
use crate::hlod::flatten::approximate::gpu::pack::{pack_boxed_nodes, Corners};
use crate::hlod::flatten::gpu::pack::{base, check_depth, float, local};

/// The doubt in the scene's units, in single precision as the kernel reads it: `DOUBT` of the
/// largest coordinate the kernel rounds, a triangle's corner or a mip's volume corner — every voxel
/// lies within its mip's volume, which may reach farther out than the triangles.
fn doubt(packed: &[Corners], volumes: &[[f32; 3]]) -> f32 {
    let corners = packed.iter().flatten().chain(volumes);
    let largest = corners.flatten().fold(0.0f32, |m, x| m.max(x.abs()));
    (DOUBT * f64::from(largest)) as f32
}

/// The words of `scene` about `origin`, for the voxels of `mips` along `rays`, and the doubt they
/// hold (`doubt`).
pub(super) fn pack(
    scene: &Scene,
    mips: &[MipGrid],
    rays: &[[f64; 3]],
    origin: [f64; 3],
) -> crate::Result<(Vec<u32>, f64)> {
    let tree = scene.tree();
    check_depth(&tree.nodes, MAX_DEPTH, "a mesh's distance-field tree")?;
    let packed: Vec<Corners> = (0..tree.order.len())
        .map(|slot| tree.corners(slot).map(|corner| local(corner, origin)))
        .collect();
    let mut words = vec![0u32; HEAD_WORDS];
    let mips_base = base(&words);
    let mut volumes = Vec::with_capacity(2 * mips.len());
    for mip in mips {
        let (low, high) = mip.volume();
        let (low, high) = (local(low, origin), local(high, origin));
        words.extend(low.map(f32::to_bits));
        words.push(float(mip.trace_distance));
        words.extend(high.map(f32::to_bits));
        words.push(0);
        volumes.extend([low, high]);
    }
    let doubt = doubt(&packed, &volumes);
    let rays_base = base(&words);
    for ray in rays {
        words.extend(ray.map(float));
        words.push(0);
    }
    let nodes_base = base(&words);
    pack_boxed_nodes(&mut words, &tree.nodes, &packed);
    let triangles_base = base(&words);
    for (corners, &two_sided) in packed.iter().zip(scene.two_sided()) {
        for (k, corner) in corners.iter().enumerate() {
            words.extend(corner.map(f32::to_bits));
            words.push(u32::from(k == 0 && two_sided));
        }
    }
    let head = [
        [
            nodes_base,
            triangles_base,
            tree.nodes.len() as u32,
            enough_back_faces(rays.len()) as u32,
        ],
        [rays.len() as u32, rays_base, mips_base, doubt.to_bits()],
    ];
    words[..HEAD_WORDS].copy_from_slice(head.as_flattened());
    Ok((words, f64::from(doubt)))
}
