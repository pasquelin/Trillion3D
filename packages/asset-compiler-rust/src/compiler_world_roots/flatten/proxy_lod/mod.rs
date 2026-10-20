//! The proxy builder (`builder: 'proxy'`): an HLOD actor's shell remeshed through a voxel volume
//! at the screen size its layer's first visible distance gives it (`settings`), then given unique
//! texture coordinates and its sources' materials read onto it as every builder's shell is
//! (`super::unique`, `bake::project`):
//!
//! 1. the voxel size (`compute_resolution`): the bounds' major axis over the screen size held
//!    between 50 and 900 pixels, times 1.95 / 3;
//! 2. a signed distance field with a two voxel band and the closest source polygon of each of its
//!    voxels (`mesh_to_volume.rs`);
//! 3. no gap closing: it would run only when half the merge distance exceeded a quarter voxel,
//!    and the merge distance is 0;
//! 4. the surface half a voxel outside the source (`ISO_SURFACE_VALUE`) meshed adaptively at 0.01
//!    (`volume_to_mesh.rs`), quads split in two, face averaged normals (`face_averaged_normals`);
//! 5. the source normals blended in and the vertices pulled three quarters of the way onto their
//!    closest source polygon (`transfer_and_project`);
//! 6. simplified (`parallel.rs`): to 0.2 % of the source triangles, never past the cost of
//!    removing a vertex from a cube one pixel wide;
//! 7. no collapsed wall correction: the simplified walls are kept as they come;
//! 8. angle weighted vertex normals (`angle_weighted_normals`), no hard angle split.
//!
//! The volume works in centimetres, left handed and z up: the sources enter scaled by 100 with y
//! and z swapped (a mirror, so the mesher's and simplifier's clockwise front faces come back
//! counter clockwise) and leave the same way, so every threshold here — the 3 cm fallback voxel,
//! the length scale, the normal tolerances — is a centimetre number.
mod grid;
mod mesh_to_volume;
mod parallel;
mod simplifier;
mod tables;
mod volume_to_mesh;

use crate::HlodLayer;
use mesh_to_volume::{mesh_to_volume, IndexMesh, PolyGrid};
use parallel::{parallel_simplify, AosMesh, Bounds};
use rayon::prelude::*;
use simplifier::{unit_or_kept, Vertex};
use trillion3d_math::vec3::{cross, normalize_where, unit_where_squared};
use trillion3d_math::vecn::{dot, length, squared_length, sub};
use volume_to_mesh::volume_to_mesh;

/// The remeshed shell, metres: welded positions, one angle weighted normal per vertex, triangles
/// over them, its triangles after each step (`Stages`: the iso-surface, the same with no gap
/// closing, after the slab waves, after the last simplification, twice) and the milliseconds of
/// its steps (`StageMs`: the distance field, the meshing, the normals, projection and
/// simplification).
struct ProxyMesh {
    positions: Vec<f32>,
    normals: Vec<[f32; 3]>,
    indices: Vec<u32>,
    stages: super::Stages,
    ms: super::StageMs,
}

/// The iso value, in voxels: the surface half a voxel out.
const ISO_SURFACE_VALUE: f64 = 0.5;
/// The mesher's adaptivity: cells merge only where their gradients nearly agree.
const REMESH_ADAPTIVITY: f64 = 0.01;
/// The share of the source triangles the shell keeps: 0.2 %.
const PERCENT_TO_RETAIN: f32 = 0.002;
/// The cost of removing a vertex from a cube of the feature size.
const LENGTH_SCALE: f32 = 170.0;

/// A proxy layer's settings for one actor: the screen size, pixels; the voxel it names instead of
/// the computed one (the layer's `accuracy`), centimetres; the voxel per pixel the layer names
/// instead of 1.95 / 3 (`accuracyPixels`); the atlas side, texels.
#[derive(Clone, Copy)]
struct Settings {
    screen_size: i32,
    voxel: Option<f64>,
    per_pixel: Option<f64>,
    texture_size: usize,
}

/// `layer`'s settings for sources within `bounds` first seen from `distance` metres: the screen
/// size of their bounds' sphere at that distance in the view's 1920 pixels, rounded and passed
/// unclamped — `compute_resolution` clamps its own copy, the simplification's feature cost reads
/// it as is.
fn settings(layer: &HlodLayer, (low, high): ([f64; 3], [f64; 3]), distance: f64) -> Settings {
    let radius = 0.5 * length(sub(high, low));
    Settings {
        screen_size: (super::screen_size(radius, distance) * super::SCREEN.0).round() as i32,
        voxel: layer.accuracy.map(|metres| metres * 100.0),
        per_pixel: layer.accuracy_pixels,
        texture_size: layer.texture_size,
    }
}

/// The voxel, in centimetres, of sources whose box's major axis is `object_size` centimetres.
fn compute_resolution(settings: &Settings, object_size: f64) -> f64 {
    if let Some(voxel) = settings.voxel {
        return voxel;
    }
    let pixels = settings.screen_size.clamp(50, 900);
    if object_size > 0.0 {
        let length_per_pixel = object_size / f64::from(pixels);
        // 1.95 / 3 of a pixel's length unless the layer names its own.
        length_per_pixel
            * settings
                .per_pixel
                .unwrap_or(crate::DEFAULT_HLOD_VOXEL_PIXELS)
    } else {
        3.0
    }
}

/// The voxel, metres, of `layer`'s sources within `bounds` first seen from `distance`:
/// `compute_resolution` on their box's major axis in centimetres — the one
/// rule every builder that sizes a voxel from that distance reads (`super::layer_settings`).
pub(super) fn voxel(layer: &HlodLayer, bounds: ([f64; 3], [f64; 3]), distance: f64) -> f64 {
    let (low, high) = bounds;
    let major = trillion3d_math::aabb::longest_side(low, high) * 100.0;
    compute_resolution(&settings(layer, bounds, distance), major) / 100.0
}

/// Our metres to the volume's frame (see the module note): centimetres, y and z swapped.
fn to_proxy_frame(p: [f32; 3]) -> [f32; 3] {
    [p[0], p[2], p[1]].map(|c| (f64::from(c) * 100.0) as f32)
}

/// The volume's frame back to our metres.
fn from_proxy_frame(p: [f32; 3]) -> [f32; 3] {
    [p[0], p[2], p[1]].map(|c| (f64::from(c) / 100.0) as f32)
}

/// The triangle's unit normal, negated: the mesher and the simplifier wind front faces clockwise.
fn face_normal(tri: [[f32; 3]; 3]) -> [f32; 3] {
    unit_or_kept(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))).map(|c| -c)
}

/// The sources as one mesh:
/// world positions in centimetres, the triangles of every mesh in order.
struct Source {
    positions: Vec<[f32; 3]>,
    tris: Vec<[u32; 3]>,
    bounds: Bounds,
}

impl Source {
    fn new(meshes: &[super::Mesh]) -> Source {
        let mut positions = Vec::new();
        let mut tris = Vec::new();
        for &(p, indices) in meshes {
            let base = positions.len() as u32;
            positions.extend(p.as_chunks::<3>().0.iter().map(|&v| to_proxy_frame(v)));
            tris.extend(
                indices
                    .as_chunks::<3>()
                    .0
                    .iter()
                    .map(|t| t.map(|i| base + i)),
            );
        }
        // The bounds: the corners of every triangle.
        let (min, max) = trillion3d_math::aabb::aabb_of_f32(
            tris.iter().flatten().map(|&v| positions[v as usize]),
        );
        Source {
            positions,
            tris,
            bounds: Bounds { min, max },
        }
    }

    fn corners(&self, poly: usize) -> [[f32; 3]; 3] {
        self.tris[poly].map(|v| self.positions[v as usize])
    }

    /// Whether the bounds are wider than flat on every axis.
    fn has_volume(&self) -> bool {
        (0..3).all(|k| self.bounds.min[k] < self.bounds.max[k])
    }
}

/// The barycentric weights of
/// `point` projected on the triangle's plane.
fn barycentric(v: [[f32; 3]; 3], point: [f32; 3]) -> [f64; 3] {
    let u = sub(v[1], v[0]);
    let w = sub(v[2], v[0]);
    let p = sub(point, v[0]);
    let norm = cross(u, w);
    let nsqr = squared_length(norm);
    let gamma = f64::from(dot(cross(u, p), norm) / nsqr);
    let beta = f64::from(dot(cross(p, w), norm) / nsqr);
    [1.0 - gamma - beta, beta, gamma]
}

/// The corner values weighted in single precision: each term rounded to float, summed in float.
fn interpolate(w: [f64; 3], v: [[f32; 3]; 3]) -> [f32; 3] {
    let term = |i: usize| v[i].map(|c| (f64::from(c) * w[i]) as f32);
    let (a, b, c) = (term(0), term(1), term(2));
    std::array::from_fn(|k| a[k] + b[k] + c[k])
}

fn missed(w: [f64; 3]) -> bool {
    w.iter().any(|&x| x > 1.0 || x < 0.0)
}

/// The closest polygon recorded at the voxel nearest `pos`.
fn closest_poly(field: &PolyGrid, inv_voxel: f64, pos: [f32; 3]) -> Option<usize> {
    let ijk = pos.map(|c| (f64::from(c) * inv_voxel + 0.5).floor() as i32);
    field.probe(ijk).map(|p| p as usize)
}

/// The source normals blended in, then the vertices pulled onto the source, in that order: a
/// vertex whose projection lands inside its closest polygon adds three times that polygon's normal
/// when they agree (dot over 0.2), then moves three quarters of the way onto the projection when
/// within three voxels. The source normals are each source triangle's face normal: the meshes
/// reach the builder without normals. One lookup a vertex: the normal moves, never the position
/// the polygon is found from, before the position does.
fn transfer_and_project(source: &Source, field: &PolyGrid, voxel: f64, mesh: &mut AosMesh) {
    let inv = 1.0 / voxel;
    let max_close_dist_sqr = (9.0 * voxel * voxel) as f32;
    mesh.verts.par_iter_mut().for_each(|vert| {
        let Some(poly) = closest_poly(field, inv, vert.pos) else {
            return;
        };
        let corners = source.corners(poly);
        let weights = barycentric(corners, vert.pos);
        if missed(weights) {
            return;
        }
        let normal = face_normal(corners);
        let transferred =
            unit_where_squared(interpolate(weights, [normal; 3]), |square| square > 0.1);
        if let Some(transferred) = transferred.filter(|&t| dot(t, vert.normal) > 0.2) {
            vert.normal = unit_or_kept(std::array::from_fn(|k| {
                vert.normal[k] + 3.0 * transferred[k]
            }));
        }
        let projected = interpolate(weights, corners).map(f64::from);
        let current = vert.pos.map(f64::from);
        if squared_length(sub(projected, current)) < f64::from(max_close_dist_sqr) {
            let q = f64::from(0.25f32);
            let r = f64::from(0.75f32);
            vert.pos = std::array::from_fn(|k| (q * current[k] + r * projected[k]) as f32);
        }
    });
}

/// Each vertex's normal: the normalized sum of its triangles' face normals.
fn face_averaged_normals(mesh: &mut AosMesh) {
    let mut sums = vec![[0.0f32; 3]; mesh.verts.len()];
    for t in mesh.indexes.chunks_exact(3) {
        let n = face_normal([t[0], t[1], t[2]].map(|v| mesh.verts[v as usize].pos));
        for &v in t {
            let s = &mut sums[v as usize];
            *s = std::array::from_fn(|k| s[k] + n[k]);
        }
    }
    for (vert, n) in mesh.verts.iter_mut().zip(sums) {
        vert.normal = unit_or_kept(n);
    }
}

/// Angle weighted vertex normals for clockwise winding: each vertex's normal the
/// sum of its triangles' face normals weighted by the corner's angle, negated for the clockwise
/// winding.
fn angle_weighted_normals(positions: &[[f32; 3]], indices: &[u32]) -> Vec<[f32; 3]> {
    fn normalize(v: [f32; 3]) -> [f32; 3] {
        normalize_where(v, |l| l > 0.0).unwrap_or([0.0; 3])
    }
    fn angle(a: [f32; 3], b: [f32; 3]) -> f32 {
        dot(normalize(a), normalize(b)).clamp(-1.0, 1.0).acos()
    }
    let mut sums = vec![[0.0f32; 3]; positions.len()];
    for t in indices.chunks_exact(3) {
        let [p0, p1, p2] = [t[0], t[1], t[2]].map(|v| positions[v as usize]);
        let (u, v) = (sub(p1, p0), sub(p2, p0));
        let face = normalize(cross(u, v));
        let w = [
            angle(u, v),
            angle(sub(p2, p1), sub(p0, p1)),
            angle(sub(p0, p2), sub(p1, p2)),
        ];
        for (corner, &vert) in t.iter().enumerate() {
            let s = &mut sums[vert as usize];
            *s = std::array::from_fn(|k| face[k] * w[corner] + s[k]);
        }
    }
    sums.into_iter().map(|s| normalize(s).map(|c| -c)).collect()
}

/// The proxy shell of `meshes` (world metres), `Err` with the reason it stands empty and the
/// triangles of its steps done: a source without volume, an empty field, iso-surface or
/// simplification refuses the actor rather than standing a unit cube or an empty mesh in.
fn proxy_mesh(
    meshes: &[super::Mesh],
    settings: &Settings,
) -> Result<ProxyMesh, (&'static str, super::Stages)> {
    let mut stages: super::Stages = [0; super::STAGE_COUNT];
    let mut ms: super::StageMs = [0; super::step::COUNT];
    let started = std::time::Instant::now();
    let source = Source::new(meshes);
    if source.tris.is_empty() || !source.has_volume() {
        return Err(("proxy invalid input geometry", stages));
    }
    let bounds = source.bounds;
    let major = bounds.max[bounds.major()] - bounds.min[bounds.major()];
    let voxel = compute_resolution(settings, f64::from(major));
    let inv = 1.0 / voxel;
    let index_points: Vec<[f64; 3]> = source
        .positions
        .iter()
        .map(|p| p.map(|c| f64::from(c) * inv))
        .collect();
    let volume = mesh_to_volume(
        &IndexMesh {
            points: &index_points,
            tris: &source.tris,
        },
        voxel,
    );
    drop(index_points);
    let (sdf, field) = volume.ok_or(("the distance field has no voxel", stages))?;
    ms[super::step::FIELD] = super::millis(started);
    let started = std::time::Instant::now();
    let mixed = volume_to_mesh(&sdf, voxel, voxel * ISO_SURFACE_VALUE, REMESH_ADAPTIVITY);
    drop(sdf);
    // Quads split clockwise: a quad (0, 1, 2), (2, 3, 0).
    let mut mesh = AosMesh {
        verts: mixed
            .points
            .iter()
            .map(|&pos| Vertex {
                pos,
                ..Default::default()
            })
            .collect(),
        indexes: mixed
            .quads
            .iter()
            .flat_map(|q| [q[0], q[1], q[2], q[2], q[3], q[0]])
            .chain(mixed.triangles.iter().flat_map(|t| *t))
            .collect(),
    };
    drop(mixed);
    ms[super::step::MARCH] = super::millis(started);
    let started = std::time::Instant::now();
    stages[0] = mesh.indexes.len() / 3;
    stages[1] = stages[0];
    if mesh.indexes.is_empty() {
        return Err(("the iso-surface has no triangle", stages));
    }
    face_averaged_normals(&mut mesh);
    transfer_and_project(&source, &field, voxel, &mut mesh);
    drop(field);

    // The feature cost of a cube one pixel wide.
    let extents: [f32; 3] = std::array::from_fn(|k| bounds.max[k] - bounds.min[k]);
    let dist_per_pixel = length(extents) / settings.screen_size as f32;
    let max_feature_cost = dist_per_pixel * dist_per_pixel * dist_per_pixel * LENGTH_SCALE;
    stages[2] = parallel_simplify(&bounds, source.tris.len(), max_feature_cost, &mut mesh);
    stages[3] = mesh.indexes.len() / 3;
    stages[4] = stages[3];
    if mesh.indexes.is_empty() {
        return Err(("the simplification removed every triangle", stages));
    }
    let positions: Vec<[f32; 3]> = mesh.verts.iter().map(|v| v.pos).collect();
    let normals = angle_weighted_normals(&positions, &mesh.indexes);
    ms[super::step::SIMPLIFY] = super::millis(started);
    Ok(ProxyMesh {
        positions: positions
            .iter()
            .flat_map(|&p| from_proxy_frame(p))
            .collect(),
        normals: normals.iter().map(|&n| [n[0], n[2], n[1]]).collect(),
        indices: mesh.indexes,
        stages,
        ms,
    })
}

/// A proxy layer's actor first seen from `distance`, as `super::built` dispatches it beside
/// `approximated`: the proxy shell of `meshes` at the layer's settings (`settings`), given unique
/// texture coordinates, the objects `sources` gives — with their materials, called only once the
/// shell stands and dropped once traced — read onto it. `Err` with the reason the shell could not
/// be made and the triangles of its steps done.
pub(super) fn built<P: std::borrow::Borrow<[super::Object]>>(
    layer: &HlodLayer,
    meshes: &[super::Mesh],
    sources: (impl FnOnce() -> P, &super::Library),
    distance: f64,
) -> super::Built {
    let settings = settings(layer, super::bounds_of(meshes), distance);
    let shell = proxy_mesh(meshes, &settings)?;
    let corner_normals: Vec<[f32; 3]> = (shell.indices.iter())
        .map(|&v| shell.normals[v as usize])
        .collect();
    super::baked(
        (shell.positions, shell.indices, corner_normals),
        sources,
        settings.texture_size,
        (None, shell.stages, shell.ms),
    )
}

/// The bytes an iso-surface triangle holds at the peak, the simplification: its quadric and its
/// vertex's, its edges' in the hash and the heap, its vertex's adjacency and boundary quadric
/// (the quadric caches, `simplifier.rs`). A cell of 15.37 million
/// iso-surface triangles peaked at 13.6 GB: a bound.
const ISO_TRIANGLE_BYTES: usize = 900;
/// The iso-surface triangles a grid of unit voxels makes per square metre of skin the solid
/// shows the three axes (`world.rs`): each crossed cell's quad splits in two.
const ISO_TRIANGLES_PER_SKIN: f64 = 2.0;

/// The bytes the iso-surface HLOD layer `layer`'s proxy actor first seen from `distance` makes
/// holds, for a solid whose skin shows the axes `skin` square metres within `bounds`, at its voxel
/// (`compute_resolution` on the bounds' major axis).
pub(super) fn surface_bytes(
    skin: f64,
    bounds: ([f64; 3], [f64; 3]),
    (layer, distance): (&HlodLayer, f64),
) -> usize {
    let (low, high) = bounds;
    if !(0..3).all(|k| low[k] <= high[k]) {
        return 0;
    }
    let voxel = voxel(layer, bounds, distance);
    let iso = (ISO_TRIANGLES_PER_SKIN * skin / (voxel * voxel)).max(1.0);
    (iso as usize).saturating_mul(ISO_TRIANGLE_BYTES)
}
