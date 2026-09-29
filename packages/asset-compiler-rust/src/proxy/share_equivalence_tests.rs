//! Lossless sharing has no geometry path of its own: compare expansion with the flat assembler.
use super::apply;
use crate::proxy::{assemble::assemble, bvh, encode::tests::fixture, tracer, SceneProxy};

fn expanded(proxy: &SceneProxy) -> Vec<f32> {
    let mut triangles = proxy.triangles.clone();
    let mut at = 0;
    for (shape, map) in &proxy.sharing.instances {
        for &source in &proxy.sharing.shapes[*shape as usize] {
            let position = proxy.sharing.positions[at] as usize;
            at += 1;
            for vertex in 0..3 {
                let from = source as usize * 9 + vertex * 3;
                let point = apply(map, &proxy.triangles[from..from + 3]);
                triangles[position * 9 + vertex * 3..position * 9 + vertex * 3 + 3]
                    .copy_from_slice(&point);
            }
            assert_eq!(proxy.albedo[position], proxy.albedo[source as usize]);
        }
    }
    triangles
}

fn world(mut triangles: Vec<f32>, mut tags: Vec<u32>) -> tracer::World {
    let tree = bvh::build(&mut triangles, &mut tags);
    let (node_bounds, node_links) = bvh::flatten(&tree);
    tracer::World {
        triangles,
        tags,
        node_bounds,
        node_links,
    }
}

#[test]
fn expanded_grid_and_random_inputs_keep_flat_bits_and_ray_hits() {
    let mut seed = 957u32;
    let mut random = || {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        f64::from(seed) / f64::from(u32::MAX)
    };
    for count in [0, 1, 60, 1000] {
        let proxy = fixture::lattice(count, fixture::plate());
        let triangles = expanded(&proxy);
        assert_eq!(
            triangles.iter().map(|v| v.to_bits()).collect::<Vec<_>>(),
            proxy
                .triangles
                .iter()
                .map(|v| v.to_bits())
                .collect::<Vec<_>>()
        );
        let a = world(proxy.triangles.clone(), proxy.albedo.clone());
        let b = world(triangles, proxy.albedo.clone());
        for _ in 0..128 {
            let origin = [random() * 40., 45., random() * 40.];
            let ray = tracer::normalise([random() - 0.5, -1., random() - 0.5]);
            let x = tracer::trace(&a, origin, ray, 100., false);
            let y = tracer::trace(&b, origin, ray, 100., false);
            assert_eq!(
                (x.found, x.triangle, x.distance.to_bits()),
                (y.found, y.triangle, y.distance.to_bits())
            );
        }
    }
    for _ in 0..16 {
        let cut: Vec<f32> = (0..90).map(|_| (random() * 2.) as f32).collect();
        let proxy = fixture::lattice(20, cut);
        let expanded = expanded(&proxy);
        assert_eq!(
            expanded.iter().map(|v| v.to_bits()).collect::<Vec<_>>(),
            proxy
                .triangles
                .iter()
                .map(|v| v.to_bits())
                .collect::<Vec<_>>()
        );
    }
    // The unchanged flat assembly is independently used without any instance metadata.
    let flat = assemble(&[], fixture::plate(), vec![7; 32]);
    assert!(flat.sharing.instances.is_empty());
}

#[test]
fn ten_thousand_random_runs_round_trip_every_coordinate() {
    use crate::compiler_world::{translation, IDENTITY};
    let mut seed = 957u32;
    for _ in 0..10_000 {
        let source: Vec<f32> = (0..72)
            .map(|_| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                (seed % 1000) as f32 / 8.0
            })
            .collect();
        let mut flat = source.clone();
        crate::proxy::place(&source, &translation([256., 0., 0.]), &mut flat);
        let colours = vec![7; 16];
        let owners: Vec<u32> = (0..16).map(|i| u32::from(i >= 8)).collect();
        let worlds: Vec<f64> = IDENTITY
            .into_iter()
            .chain(translation([256., 0., 0.]))
            .collect();
        let sharing = super::share(
            &flat,
            &colours,
            &owners,
            &(0..16).collect::<Vec<_>>(),
            &worlds,
        );
        assert_eq!(sharing.instances.len(), 2);
        let proxy = SceneProxy {
            triangles: flat,
            albedo: colours,
            sharing,
            ..SceneProxy::default()
        };
        assert_eq!(
            expanded(&proxy)
                .iter()
                .map(|v| v.to_bits())
                .collect::<Vec<_>>(),
            proxy
                .triangles
                .iter()
                .map(|v| v.to_bits())
                .collect::<Vec<_>>()
        );
    }
}
