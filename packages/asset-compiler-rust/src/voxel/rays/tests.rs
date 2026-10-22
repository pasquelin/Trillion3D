//! The rays' tests: what is cast, what is left out, and what is shared.
use super::super::sample::{Cast, Caster, Probe};
use super::super::tests::two_quads;
use super::*;
use crate::trace::surface::material::Surface;
use crate::trace::surface::mesh::Corners;
use crate::trace::surface::Traceable;
use crate::trace::tracer::Among;

/// The two quads of `two_quads` as a mesh: the target at z = 0.5, inside the voxel
/// `[0, 0, 0]` of side 1, and an occluder at z = -0.5 in the voxel below it, which does not
/// overlap the voxel.
fn target_and_occluder() -> Traceable {
    let corners = (0..4).map(|_| Corners::default()).collect();
    let surface = Surface::of(&serde_json::json!({}), None, &[]);
    Traceable::new(two_quads(), vec![0; 4], corners, vec![surface])
}

// Behaviour: the rays of one shape are drawn once for the process: builds that differ in their
// level, their spread or their opacity — or ask a count the packets round to the same — share
// one bank; a build that asks other rays, separable ones or a back-up has a bank of its own.
#[test]
fn builds_with_the_same_rays_share_one_bank() {
    let base = VoxelSettings::default();
    let first = RayBank::of(&base);
    let alike = VoxelSettings {
        level: 2,
        ndf: false,
        opacity: true,
        ..base
    };
    assert!(Arc::ptr_eq(&first, &RayBank::of(&alike)));
    let rounded = VoxelSettings {
        asked_rays: 57,
        ..base
    };
    assert!(Arc::ptr_eq(&first, &RayBank::of(&rounded)));
    let others = [
        VoxelSettings {
            asked_rays: 16,
            ..base
        },
        VoxelSettings {
            separable: true,
            ..base
        },
        VoxelSettings {
            back_up: 0.5,
            ..base
        },
    ];
    for other in others {
        assert!(!Arc::ptr_eq(&first, &RayBank::of(&other)));
    }
}

// Behaviour: a ray whose nearest hit lies in its back-up stretch is left out of the voxel's
// count — neither a hit nor a miss —, where one backed up by less, or an occluder out of the
// stretch, leaves it a hit: the occluder here is a side and a half under the voxel's centre,
// outside the voxel.
#[test]
fn a_backed_up_ray_met_before_its_voxel_is_left_out_of_the_count() {
    let mesh = target_and_occluder();
    let near = [0.0; 4];
    let settings = VoxelSettings::default();
    let bank = RayBank::of(&settings);
    let probe = Probe {
        mesh: &mesh,
        near: &near,
        tie: mesh.tie(),
        settings,
        bank: &bank,
    };
    // Up the target's column, from `z` (voxel sides from the centre of voxel `[0, 0, 0]`).
    let ray = |z: f64| Ray {
        direction: [0.0, 0.0, 1.0],
        enter: [-0.25, -0.25, z],
        length: 0.5 - z,
        face: 4,
        weight: 1.0,
        footprint: [[0.0; 3]; 2],
    };
    let cast = |ranks: &[u32], ray: Ray, window: (f64, f64)| {
        let among = Among {
            ranks,
            near: &near,
            from: 0.0,
            tie: probe.tie,
        };
        let caster = Caster {
            probe: &probe,
            among,
            centre: [0.5; 3],
            side: 1.0,
        };
        caster.cast(&ray, window)
    };
    let (everything, target) = ([0, 1, 2, 3], [0, 1]);
    // Backed up a side before the voxel's bottom: the occluder, half a side from the start,
    // lies in the stretch; without it the ray hits the target.
    let backed_up = (1.0, f64::INFINITY);
    assert!(matches!(
        cast(&everything, ray(-1.5), backed_up),
        Cast::Left
    ));
    assert!(matches!(cast(&target, ray(-1.5), backed_up), Cast::Hit(_)));
    // Not backed up, the occluder is behind the start: the ray hits the target.
    let open = (0.0, f64::INFINITY);
    assert!(matches!(cast(&everything, ray(-0.5), open), Cast::Hit(_)));
}
