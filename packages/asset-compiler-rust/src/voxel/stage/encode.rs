//! The voxel records encoded, and the report.
use super::super::bricks::{brick_record, voxel_record, BRICK_BYTES, VOXEL_BYTES};
use super::super::raster::Cell;
use super::super::{ERROR_PER_SIZE, VOXEL_FILE, VOXEL_VERSION};
use super::{VoxelInputs, Voxelized, Voxelled, GROUP_BYTES, HEAD_BYTES};
use serde_json::{json, Value};

/// `voxels.bin`: the head, the groups' records, the bricks, the voxels.
pub(super) fn encode(done: &[Voxelled]) -> Vec<u8> {
    // Each group beside the settings of its mesh, which its voxels' records follow.
    let groups =
        || (done.iter()).flat_map(|mesh| mesh.groups.iter().map(move |g| (g, &mesh.settings)));
    let bricks: usize = groups().map(|(g, _)| g.bricks.len()).sum();
    let voxels: usize = groups().map(|(g, _)| g.voxels.len()).sum();
    let count = groups().count();
    let mut head = Vec::with_capacity(HEAD_BYTES + count * GROUP_BYTES);
    let mut brick_bytes = Vec::with_capacity(bricks * BRICK_BYTES);
    let mut voxel_bytes = Vec::with_capacity(voxels * VOXEL_BYTES);
    head.extend_from_slice(b"T3VX");
    for word in [VOXEL_VERSION, count as u32, bricks as u32] {
        head.extend_from_slice(&word.to_le_bytes());
    }
    for (group, settings) in groups() {
        let first: Cell =
            std::array::from_fn(|k| group.bricks.iter().map(|b| b.at[k]).min().unwrap_or(0));
        let origin = first.map(|c| (f64::from(c) * 4.0 * group.side) as f32);
        let words = [
            group.primitive.map_or(u32::MAX, |p| p as u32),
            group.group as u32,
            (brick_bytes.len() / BRICK_BYTES) as u32,
            group.bricks.len() as u32,
            (voxel_bytes.len() / VOXEL_BYTES) as u32,
            group.voxels.len() as u32,
        ];
        for word in words {
            head.extend_from_slice(&word.to_le_bytes());
        }
        let errors = [group.error(), group.parent_error(), group.side].map(|e| e as f32);
        for value in errors.into_iter().chain(origin) {
            head.extend_from_slice(&value.to_le_bytes());
        }
        for brick in &group.bricks {
            brick_bytes.extend_from_slice(&brick_record(brick, first));
            for &v in &brick.voxels {
                voxel_bytes.extend_from_slice(&voxel_record(&group.voxels[v], settings));
            }
        }
    }
    head.extend(brick_bytes);
    head.extend(voxel_bytes);
    head
}

/// The manifest's `voxels` section: the file's layout and totals, and every mesh's groups.
pub(super) fn report(inputs: &VoxelInputs<'_>, done: &[Voxelled], bytes: usize) -> Value {
    let all = || done.iter().flat_map(|mesh| mesh.groups.iter());
    let finite = |e: f64| e.is_finite().then_some(e);
    let group = |g: &Voxelized| {
        json!({"primitive": g.primitive, "group": g.group, "level": g.level,
        "triangleError": finite(g.triangle_error), "error": g.error(),
        "parentError": finite(g.parent_error()), "side": g.side, "forced": g.forced,
        "bricks": g.bricks.len(), "voxels": g.voxels.len()})
    };
    let meshes: Vec<Value> = (done.iter())
        .map(|mesh| {
            let seeded = (inputs.primitives.iter().zip(inputs.seeds))
                .filter(|(p, _)| p["mesh"].as_u64() == Some(mesh.mesh as u64))
                .map(|(_, seed)| seed.groups.len().saturating_sub(1))
                .sum::<usize>();
            json!({"mesh": mesh.mesh, "voxelsFrom": mesh.voxels_from, "seeded": seeded,
                "groups": mesh.groups.iter().map(group).collect::<Vec<_>>()})
        })
        .collect();
    json!({"version": VOXEL_VERSION, "file": VOXEL_FILE, "bytes": bytes,
        "headBytes": HEAD_BYTES, "groupBytes": GROUP_BYTES, "brickBytes": BRICK_BYTES,
        "voxelBytes": VOXEL_BYTES, "errorPerSide": ERROR_PER_SIZE,
        "groups": all().count(),
        "bricks": all().map(|g| g.bricks.len()).sum::<usize>(),
        "voxels": all().map(|g| g.voxels.len()).sum::<usize>(), "meshes": meshes})
}
