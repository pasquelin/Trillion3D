//! A mesh's voxels measured on the GPU, on the compile's one device (`hlod/flatten/gpu.rs`): the
//! mesh's whole tree packed once on the CPU — its nodes, its triangles in leaf order, each marked
//! two-sided or not, about the mesh's box centre in single precision (`pack.rs`) — then the voxels
//! of every brick that holds a triangle's reach sent to it in batches, one invocation a voxel, two
//! batches at once (`gpu::Batches`): the CPU makes the next batch's positions while the device
//! runs the one before. Each invocation does what the CPU does voxel by voxel
//! (`Scene::signed_distance`), step for step (`field.wgsl`, on the walks of `tree.wgsl`): the
//! nearest triangle nearer than the trace distance, strictly, else the trace distance; then, for a
//! voxel with one, the 98 rays, each `direction × trace` from a start pulled back by a ten
//! thousandth of the trace, skipped when it misses the mip's volume, each meeting the nearest
//! triangle of the whole tree — a tie to the lower slot — and counted when that is a back face of
//! a triangle that is not two-sided, stopping as soon as a quarter of the rays are counted or the
//! rays left could not make a quarter. The bricks themselves are classified on the CPU, with the
//! tree (`Scene::reaches`): a brick no triangle lies near is the band's far end all through, as
//! on the CPU, and none of its voxels is sent. The host quantises the distances exactly as the
//! CPU's build does (`brick::quantise`).
//!
//! The mesh's tree must fit one storage binding and the walk's stack: a mesh that does not has no
//! GPU build — its rays would have to meet the nearest triangle over several bindings, each ray's
//! first hit kept across them —, and neither has a device that does not open or a batch that fails.
//! Any of them returns an error, and the field is built on the CPU (`build.rs`). One mesh runs on
//! the device at a time, the others packing and classifying meanwhile.
//!
//! Precision: the GPU's field is the CPU's, byte for byte. Positions are taken about the box centre
//! in single precision, about `6·10⁻⁸ R` of rounding for a box of half size `R`; every box is
//! recomputed from the corners as packed and widened past the kernel's rounding, so no box prunes a
//! triangle it holds. A step single precision may decide otherwise than double is never taken on
//! trust: the kernel marks its voxel doubtful (`layout::DOUBTFUL`) wherever a step comes within the
//! doubt (`layout::DOUBT`, some thirty times that rounding) of its other outcome — a ray passing that
//! near a triangle's edge, its plane or its own ends, two meetings that near each other along a ray,
//! the nearest triangle that near the trace distance —, and the host marks one whose distance lies
//! that near a step of its byte (`near_a_step`). Every voxel marked is measured again on the CPU in
//! double precision (`remeasure`); every other one took the steps the CPU takes, so its byte is the
//! CPU's. The proof is the comparison of both builds, byte for byte (`gpu/tests.rs`).
//!
//! A device may drop invocations of this kernel and raise no error: measured on an Apple GPU, a
//! batch of sponza lost whole SIMD groups now and then — 0.1 to 4 % of the field's bytes wrong,
//! other ones each run; the cause is not found. Each batch's values start all ones (`Batches::mark_unwritten`), which no voxel the
//! kernel measures holds: a dropped one is doubtful and measured on the CPU, so the field is the
//! CPU's whatever the device dropped, every run.
use super::brick::{quantise, Brick, Frame, BRICK_VOXELS};
use super::build::cell;
use super::grid::MipGrid;
use super::scene::Scene;
use crate::hlod::flatten::gpu::layout::FILLED;
use crate::hlod::flatten::gpu::pack::local;
use crate::hlod::flatten::gpu::{
    device, failed, held_bytes, scoped, unwritten_bytes, Batches, Program, Source,
};
use crate::plugins::scene::cancel;
use layout::{echo, DOUBTFUL, ECHO_MASK, ECHO_SHIFT};
use rayon::prelude::*;
use std::cell::RefCell;
use std::collections::VecDeque;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use trillion3d_page_codec::proxy::PROXY_LEAF_TRIANGLES;
mod layout;
mod pack;
#[cfg(test)]
mod tests;

/// The voxels' positions in the batches: a position and its mip, four floats, and a value is the
/// distance's bits and the count of back faces its rays met.
type Item = [f32; 4];
type Value = [u32; 2];

/// Bytes a triangle takes packed for the device (`pack.rs`): its records, and its share of the
/// boxed nodes — at most two a half-full leaf.
pub(super) const PACKED_TRIANGLE_BYTES: usize = layout::TRIANGLE_RECORDS * 16
    + (2 * layout::BOX_NODE_RECORDS * 16).div_ceil(PROXY_LEAF_TRIANGLES / 2);

/// Bytes a voxel takes measured: its byte, its brick's copy, and its entry when doubtful.
pub(super) const VOXEL_BYTES: usize = 2 + size_of::<Doubtful>();

/// What `measure` holds on the device for a mesh of `voxels` voxels at most: its two slots — the
/// items, the results and their read-back (`held_bytes`) — and the all-ones results
/// (`unwritten_bytes`), in the host's memory on a device that shares it.
pub(super) fn batch_bytes(voxels: usize) -> usize {
    let size = (size_of::<Item>(), size_of::<Value>());
    held_bytes(size, voxels).saturating_add(unwritten_bytes(size.1, voxels))
}

/// The device runs one mesh's voxels at a time: its buffers are a batch's worth, not a mesh's.
static ONE_MESH: Mutex<()> = Mutex::new(());

/// The kernel's program: the prelude, the tree's walks and the kernel, its bindings
/// (`layout::bindings`).
fn source() -> Source {
    let wgsl = [
        layout::prelude().as_str(),
        include_str!("../hlod/flatten/approximate/gpu/tree.wgsl"),
        include_str!("gpu/field.wgsl"),
    ]
    .concat();
    Source {
        label: "distance field",
        wgsl,
        bindings: layout::bindings(),
        passes: &["field"],
    }
}

/// The bricks of every mip that hold a triangle's reach, as `(mip, rank)`: mip after mip, rank
/// after rank. Any other brick is the band's far end all through (`Frame::reached`).
fn touched(scene: &Scene, mips: &[MipGrid]) -> Vec<(usize, usize)> {
    let mut found = Vec::new();
    for (index, mip) in mips.iter().enumerate() {
        let reached: Vec<usize> = (0..mip.cells())
            .into_par_iter()
            .filter(|&rank| Frame::of(mip, cell(rank, mip.bricks)).reached(mip, scene))
            .collect();
        found.extend(reached.into_iter().map(|rank| (index, rank)));
    }
    found
}

/// Every brick of every mip, cell after cell: the `touched` ones from their measured `voxels`, the
/// others clear.
fn bricks(mips: &[MipGrid], touched: &[(usize, usize)], voxels: &[u8]) -> Vec<Vec<Brick>> {
    let mut bricks: Vec<Vec<Brick>> = (mips.iter())
        .map(|mip| {
            let clear = Brick::clear(mip);
            vec![clear; mip.cells()]
        })
        .collect();
    for (&(mip, rank), measured) in touched.iter().zip(voxels.chunks_exact(BRICK_VOXELS)) {
        bricks[mip][rank] = Brick::of(measured.to_vec());
    }
    bricks
}

/// Whether `distance`, measured in single precision, lies within four doubts of a step of `mip`'s
/// bytes — a distance's own rounding is a few of its coordinates' —: the byte the double distance
/// gives may then be the next one.
fn near_a_step(mip: &MipGrid, distance: f64, doubt: f64) -> bool {
    let [scale, bias] = mip.scale_bias();
    let byte = ((distance * mip.to_volume - bias) / scale) * 255.0 + 0.5;
    let margin = 4.0 * doubt * mip.to_volume / scale * 255.0;
    (byte - byte.round()).abs() < margin
}

/// A voxel of `touched` to measure again on the CPU: its rank, and the distance the GPU gave when
/// every step of it but the distance's own rounding was certain.
type Doubtful = (usize, Option<f64>);

/// The `doubtful` voxels of `touched` measured again on the CPU, in double precision, their bytes
/// written over the GPU's in `voxels`. A voxel whose sign the GPU settled, its distance alone near
/// a step of the bytes, needs the nearest triangle alone: its rays meet what they met on the GPU.
fn remeasure(
    scene: &Scene,
    (mips, rays): (&[MipGrid], &[[f64; 3]]),
    touched: &[(usize, usize)],
    (doubtful, voxels): (&[Doubtful], &mut [u8]),
    cancelled: &AtomicBool,
) -> crate::Result<()> {
    let measured: Vec<u8> = (doubtful.par_iter())
        .map(|&(at, settled)| {
            cancel::check(cancelled)?;
            let (mip, rank) = touched[at / BRICK_VOXELS];
            let grid = &mips[mip];
            let position = Frame::of(grid, cell(rank, grid.bricks)).voxel(at % BRICK_VOXELS);
            let trace = grid.trace_distance;
            let distance = match settled {
                Some(signed) if signed.abs() < trace => (scene.distance(position, trace))
                    .map_or(trace, |distance| distance.copysign(signed)),
                Some(_) => trace,
                None => scene.signed_distance(position, trace, (rays, grid.volume())),
            };
            Ok(quantise(grid, distance))
        })
        .collect::<crate::Result<_>>()?;
    for (&(at, _), byte) in doubtful.iter().zip(measured) {
        voxels[at] = byte;
    }
    Ok(())
}

/// Every brick of every mip of `scene`, cell after cell, measured along `rays` on the GPU, and how
/// many of their voxels were doubtful and measured again on the CPU; an error when the GPU cannot
/// (see the module's text), or the compilation's refusal once `cancelled` is raised.
pub(super) fn measure(
    scene: &Scene,
    mips: &[MipGrid],
    rays: &[[f64; 3]],
    cancelled: &AtomicBool,
) -> crate::Result<(Vec<Vec<Brick>>, usize)> {
    let touched = touched(scene, mips);
    if touched.is_empty() {
        return Ok((bricks(mips, &touched, &[]), 0));
    }
    if rays.len() >= 1 << ECHO_SHIFT {
        return Err(failed(format!(
            "{} rays leave no room for a voxel's echo",
            rays.len()
        )));
    }
    let device = device()?;
    let passes = device.passes(Program::DistanceField, source)?;
    let origin = [0, 1, 2].map(|k| 0.5 * (scene.low[k] + scene.high[k]));
    let (words, doubt) = pack::pack(scene, mips, rays, origin)?;
    let bytes: &[u8] = bytemuck::cast_slice(&words);
    if bytes.len() as u64 > device.page_bytes() {
        return Err(failed(format!(
            "a mesh's distance-field tree takes {} MB, past one GPU binding, {} MB",
            bytes.len() >> 20,
            device.page_bytes() >> 20
        )));
    }
    let mut doubtful: Vec<Doubtful> = Vec::new();
    let mut voxels = {
        let _alone = ONE_MESH
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let uploaded = scoped(device, || {
            let buffer = device.buffer("distance field scene", bytes.len() as u64, FILLED)?;
            device.queue().write_buffer(&buffer, 0, bytes);
            Ok(buffer)
        })?;
        let layout = &passes.layout;
        let bound = uploaded.clone();
        let bind = move |params: &wgpu::Buffer, items: &wgpu::Buffer, results: &wgpu::Buffer| {
            device.bind("distance field", layout, [params, &bound, items, results])
        };
        let size = (size_of::<Item>() as u64, size_of::<Value>() as u64);
        let pipeline = &passes.pipelines[0];
        let mut batches = Batches::new(device, pipeline, size, bind, (vec![uploaded], cancelled))?;
        batches.mark_unwritten();
        let total = touched.len() * BRICK_VOXELS;
        let mut voxels: Vec<u8> = Vec::with_capacity(total);
        let mut next = 0;
        // Serial on purpose: this runs under `ONE_MESH`, inside a rayon worker, and a parallel
        // loop here could steal another mesh's job that locks it again on the same thread.
        // The brick the last voxel was in, its mip and its frame: a batch may start or end
        // mid-brick, and a brick's frame is made once.
        let brick_at = |brick: usize| {
            let (mip, rank) = touched[brick];
            (
                brick,
                mip,
                Frame::of(&mips[mip], cell(rank, mips[mip].bricks)),
            )
        };
        let mut held: Option<(usize, usize, Frame)> = None;
        // The echo of every point sent and not yet landed, in order (`layout::echo`).
        let echoes = RefCell::new(VecDeque::new());
        let mut fill = |items: &mut Vec<Item>, count: usize| {
            for voxel in next..next + count {
                let brick = voxel / BRICK_VOXELS;
                if held.as_ref().is_none_or(|(at, ..)| *at != brick) {
                    held = Some(brick_at(brick));
                }
                let (_, mip, frame) = held.as_ref().expect("the voxel's brick is held");
                let [x, y, z] = local(frame.voxel(voxel % BRICK_VOXELS), origin);
                let item = [x, y, z, *mip as f32];
                echoes.borrow_mut().push_back(echo(item));
                items.push(item);
            }
            next += count;
        };
        let mut land = |results: &[Value]| {
            for &[distance, count] in results {
                let at = voxels.len();
                let grid = &mips[touched[at / BRICK_VOXELS].0];
                let distance = f64::from(f32::from_bits(distance));
                let sent = echoes.borrow_mut().pop_front();
                // A voxel the device dropped kept its all-ones value (`mark_unwritten`): its count
                // holds `DOUBTFUL`, its distance is no number; one measured at another point, or
                // written at another's place, echoes another point. Each goes to the CPU whole.
                let echoed = Some((count >> ECHO_SHIFT) & ECHO_MASK) == sent;
                let settled = count & DOUBTFUL == 0 && distance.is_finite() && echoed;
                if !settled || near_a_step(grid, distance, doubt) {
                    doubtful.push((at, settled.then_some(distance)));
                }
                voxels.push(quantise(grid, distance));
            }
        };
        batches.run(total, &mut fill, &mut land)?;
        voxels
    };
    remeasure(
        scene,
        (mips, rays),
        &touched,
        (&doubtful, &mut voxels),
        cancelled,
    )?;
    Ok((bricks(mips, &touched, &voxels), doubtful.len()))
}
