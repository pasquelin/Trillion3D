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
//! A scene is uploaded in as many parts as the adapter's `max_storage_buffer_binding_size` asks,
//! each a storage binding of its own, every point read through each part in turn and the values
//! joined (`Pass::join`): the nearest distance a minimum over triangles; the winding's sum, which
//! the solids' walk stops at the first instance reaching the shell, taken part after part in the
//! walk's order and stopped at the first part that stopped — the pass writes beside each value
//! whether its walk did — so the parts give the sum of one binding. A part that no binding
//! holds fails the build with `GPU_BAKE_FAILED`.
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
pub(crate) mod layout;
pub(crate) mod pack;

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

impl Pass {
    /// The result of two parts of a scene at one point, `a` the part read first: the winding's
    /// sum unless `a` stopped it already, `b`'s stop kept; or the nearer of two distances, a miss
    /// giving way to any hit.
    fn join(self, a: Reading, b: Reading) -> Reading {
        match self {
            Pass::Winding if a.stopped => a,
            Pass::Winding => Reading {
                value: a.value + b.value,
                stopped: b.stopped,
            },
            Pass::Nearest if a.value < 0.0 => b,
            Pass::Nearest if b.value < 0.0 => a,
            Pass::Nearest => Reading {
                value: a.value.min(b.value),
                stopped: false,
            },
        }
    }
}

/// What a part answers at a point: the pass's value, and whether the winding's walk stopped early.
#[derive(Clone, Copy)]
struct Reading {
    value: f32,
    stopped: bool,
}

/// The shell's program: the prelude and its shaders, its bindings (`layout::bindings`).
fn source() -> Source {
    let wgsl = [
        layout::prelude().as_str(),
        include_str!("../gpu/scene_words.wgsl"),
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

/// The most bytes one part of a scene may take: the adapter's one storage binding.
pub(crate) fn part_bytes() -> crate::Result<u64> {
    Ok(device()?.page_bytes())
}

/// A scene on the device and the batches its points go through: a point takes 16 bytes of the
/// batch's items and 8 of its results. Destroyed when it drops.
pub(crate) struct Queries<'a> {
    pass: Pass,
    parts: Vec<(Batches<'a>, [f64; 3])>,
}

impl<'a> Queries<'a> {
    /// The scene `parts` — each its words, its positions about its origin, within `part_bytes` —
    /// uploaded for `pass`, each in a binding of its own; its waits stop when `cancelled` is
    /// raised.
    pub fn new(
        pass: Pass,
        parts: &[(Vec<u32>, [f64; 3])],
        cancelled: &'a AtomicBool,
    ) -> crate::Result<Self> {
        let device = device()?;
        let passes = device.passes(Program::Shell, source)?;
        let pipeline = &passes.pipelines[pass as usize];
        let mut made = Vec::with_capacity(parts.len());
        for (words, origin) in parts {
            let bytes: &[u8] = bytemuck::cast_slice(words);
            if bytes.len() as u64 > device.page_bytes() {
                return Err(failed(format!(
                    "a shell's scene part takes {} MB, past one GPU binding, {} MB",
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
            let bind =
                move |params: &wgpu::Buffer, items: &wgpu::Buffer, results: &wgpu::Buffer| {
                    device.bind("HLOD shell", layout, [params, &bound, items, results])
                };
            let batches = Batches::new(device, pipeline, (16, 8), bind, (vec![scene], cancelled))?;
            made.push((batches, *origin));
        }
        Ok(Self { pass, parts: made })
    }

    /// The pass's value at each of `points`, in their order, batch after batch, each packed while
    /// the device runs the one before; the parts' values joined, last part first — the order the
    /// walk reads the children of a tree, the right one first —: the least hit for the nearest,
    /// the walk's sum for the winding.
    pub fn values(&mut self, points: &[[f64; 3]]) -> crate::Result<Vec<f32>> {
        let pass = self.pass;
        let mut parts = self.parts.iter_mut().rev();
        let Some((batches, origin)) = parts.next() else {
            return Ok(Vec::new());
        };
        let mut joined = read_part(batches, *origin, points)?;
        for (batches, origin) in parts {
            let out = read_part(batches, *origin, points)?;
            for (kept, reading) in joined.iter_mut().zip(out) {
                *kept = pass.join(*kept, reading);
            }
        }
        Ok(joined.into_iter().map(|reading| reading.value).collect())
    }
}

/// One part's reading at each of `points`, which it reads about its `origin`.
fn read_part(
    batches: &mut Batches<'_>,
    origin: [f64; 3],
    points: &[[f64; 3]],
) -> crate::Result<Vec<Reading>> {
    let mut out = Vec::with_capacity(points.len());
    let mut next = points.iter();
    let mut pack = |packed: &mut Vec<[f32; 4]>, count: usize| {
        packed.extend(next.by_ref().take(count).map(|&p| {
            let [x, y, z] = local(p, origin);
            [x, y, z, 0.0]
        }));
    };
    let mut land = |results: &[[u32; 2]]| {
        out.extend(results.iter().map(|&[value, stopped]| Reading {
            value: f32::from_bits(value),
            stopped: stopped != 0,
        }))
    };
    batches.run(points.len(), &mut pack, &mut land)?;
    Ok(out)
}

/// `items` handed to `take` in as many runs as none takes more than `limit` bytes by `bytes`:
/// halved by `halve`, in order, until each run fits. Refused, naming `what`, when one item alone
/// does not.
pub(crate) fn split_to_fit<T>(
    items: Vec<T>,
    (bytes, limit, what): (&dyn Fn(&[T]) -> u64, u64, &str),
    halve: &dyn Fn(Vec<T>) -> (Vec<T>, Vec<T>),
    take: &mut dyn FnMut(Vec<T>) -> crate::Result<()>,
) -> crate::Result<()> {
    let size = bytes(&items);
    if size <= limit {
        return take(items);
    }
    if items.len() < 2 {
        return Err(failed(format!(
            "a shell's {what} takes {} MB, past one GPU binding, {} MB",
            size >> 20,
            limit >> 20
        )));
    }
    let (first, second) = halve(items);
    split_to_fit(first, (bytes, limit, what), halve, take)?;
    split_to_fit(second, (bytes, limit, what), halve, take)
}
