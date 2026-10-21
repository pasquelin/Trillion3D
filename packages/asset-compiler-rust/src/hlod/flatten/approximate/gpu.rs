//! The shell's point queries on the GPU, on the compile's one device (`flatten/gpu.rs`): a scene
//! packed once on the CPU — its trees, their triangles in leaf order, about the scene's centre in
//! single precision — then whole lists of points sent to it in batches, one invocation a point,
//! two batches at once: the CPU packs the next while the device runs the one before, read once the
//! next is sent (`Queries::values`, on the batches every pass of the device runs in,
//! `gpu::Batches`); each pass dispatched in chunks timed to stay within any GPU's watchdog. Two
//! passes (`winding.wgsl`, `nearest.wgsl`, on the walks of `tree.wgsl`):
//! - `winding`: the solid's field at each point (`winding.rs`): the sum over the instances whose
//!   box holds the point of their mesh's value there, the point brought into the mesh's space —
//!   far nodes read to the second order, near triangles by their exact solid angle, a thin part
//!   one within its shell —;
//! - `nearest`: the distance from each point to the nearest triangle within a limit, or `MISS` —
//!   the closing's band (`morphology/field.rs`).
//!
//! A scene is uploaded as one storage binding and never split: a scene past the adapter's
//! `max_storage_buffer_binding_size` fails the build with `GPU_BAKE_FAILED`.
//!
//! Precision. Positions are taken about the scene's centre, so a coordinate's rounding is one unit
//! in the last place of the scene's half size `R`: about `6·10⁻⁸ R`; a mesh's triangles about its
//! own centre, the instance's transform rows rounded alike, a point brought into its space rounded
//! by the same few units of its own half size.
//! - The solid: a closed part's winding number is exactly 0 or 1 off its surface, and the
//!   second-order cut-off the CPU builds the fields with, at `β = 2`, carries an error far above
//!   single precision's. Single precision and the shader's arc tangent add at most
//!   some 10⁻⁴ to the sum, which can never carry a 0 or a 1 across the threshold of one half; only
//!   the sign of the
//!   near triangle's solid angle can flip, the sign of a triple product, wrong only within a few
//!   `6·10⁻⁸ R` of the triangle's plane. The crossings are placed by bisection to a sixteenth of a
//!   cell, at least `R / 8192` (1024 cells across the diagonal at most): every flip lies some
//!   thousand times closer to the surface than the bisection can tell. An open solid's half level
//!   moves by the sum's error over the field's slope, as small against a cell. A shell's test, a
//!   squared distance against a squared radius, flips only within the same rounding of its rim.
//! - The closing: each distance is the nearest triangle's, measured in single precision about the
//!   centre, within a few `6·10⁻⁸ R` of the CPU's double one; every box is recomputed from the
//!   corners as packed and widened past the pass's rounding, so no box prunes the nearest triangle.
//!   The band's edge, the limit, lies two cells past the iso-level the closing meshes: a node that
//!   enters or leaves the band by a rounding changes no crossing.
//!
//! One GPU gives the same values for the same points every run, whatever the threads; two GPUs may
//! part by the rounding above.
use crate::hlod::flatten::gpu::layout::FILLED;
use crate::hlod::flatten::gpu::pack::local;
use crate::hlod::flatten::gpu::{device, failed, scoped, Batches, Program, Source};
use std::sync::atomic::AtomicBool;
pub(super) mod layout;
pub(super) mod pack;

/// The scene's head: two records of bases and counts. The solid's: the box tree's first node and
/// node count, the first instance and the instance count; the meshes' first record and whether
/// the scene is read as solids. The closing's: the first node, the first triangle, the node count,
/// the limit's bits.
pub(crate) type Head = [u32; layout::HEAD_RECORDS * 4];

/// Which pass a scene is read by, its rank in the order `source` names them.
#[derive(Clone, Copy)]
pub(crate) enum Pass {
    Winding = 0,
    Nearest = 1,
}

/// The shell's program: the prelude and its shaders, its bindings (`layout::bindings`).
fn source() -> Source {
    let wgsl = [
        layout::prelude().as_str(),
        include_str!("gpu/tree.wgsl"),
        include_str!("gpu/winding.wgsl"),
        include_str!("gpu/nearest.wgsl"),
    ]
    .concat();
    Source {
        label: "HLOD shell",
        wgsl,
        bindings: layout::bindings(),
        passes: &["winding", "nearest"],
    }
}

/// A scene on the device and the batches its points go through: a point takes 16 bytes of the
/// batch's items and 4 of its results. Destroyed when it drops.
pub(crate) struct Queries<'a> {
    batches: Batches<'a>,
    origin: [f64; 3],
}

impl<'a> Queries<'a> {
    /// The scene `words`, positions about `origin`, uploaded for `pass`; its waits stop when
    /// `cancelled` is raised.
    pub fn new(
        pass: Pass,
        words: &[u32],
        origin: [f64; 3],
        cancelled: &'a AtomicBool,
    ) -> crate::Result<Self> {
        let device = device()?;
        let passes = device.passes(Program::Shell, source)?;
        let pipeline = &passes.pipelines[pass as usize];
        let bytes: &[u8] = bytemuck::cast_slice(words);
        if bytes.len() as u64 > device.page_bytes() {
            return Err(failed(format!(
                "a shell's scene takes {} MB, past one GPU binding, {} MB",
                bytes.len() >> 20,
                device.page_bytes() >> 20
            )));
        }
        let scene = scoped(device, || {
            let scene = device.buffer("shell scene", bytes.len() as u64, FILLED)?;
            device.queue().write_buffer(&scene, 0, bytes);
            Ok(scene)
        })?;
        let layout = &passes.layout;
        let bound = scene.clone();
        let bind = move |params: &wgpu::Buffer, items: &wgpu::Buffer, results: &wgpu::Buffer| {
            device.bind("HLOD shell", layout, [params, &bound, items, results])
        };
        let batches = Batches::new(device, pipeline, (16, 4), bind, (vec![scene], cancelled))?;
        Ok(Self { batches, origin })
    }

    /// The pass's value at each of `points`, in their order, batch after batch, each packed while
    /// the device runs the one before.
    pub fn values(&mut self, points: &[[f64; 3]]) -> crate::Result<Vec<f32>> {
        let origin = self.origin;
        let mut out = Vec::with_capacity(points.len());
        let mut next = points.iter();
        let mut pack = |packed: &mut Vec<[f32; 4]>, count: usize| {
            packed.extend(next.by_ref().take(count).map(|&p| {
                let [x, y, z] = local(p, origin);
                [x, y, z, 0.0]
            }));
        };
        let mut land = |values: &[f32]| out.extend_from_slice(values);
        self.batches.run(points.len(), &mut pack, &mut land)?;
        Ok(out)
    }
}
