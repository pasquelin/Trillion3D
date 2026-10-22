//! One bake on the device: the scene, the materials and the pages uploaded once — the scene's words
//! let go once uploaded —; the texels sent in batches, two at once, as every pass of the device
//! runs (`flatten/gpu/batches.rs`: the CPU makes the next batch while the device runs the one
//! before, each batch read once the next is sent); each batch's results handed back as they
//! return, a capture's of four words a texel, a tile's of eight. Every buffer of the bake, its own
//! pages with them, is destroyed when it ends, however it ends.
use super::chains::{bound, Pages};
use super::layout::SURFACES;
use super::scene::Scene;
use crate::hlod::flatten::gpu::layout::FILLED;
use crate::hlod::flatten::gpu::{scoped, Batches, Device, Owned, Passes};
use std::mem::size_of;
use std::sync::atomic::AtomicBool;

/// The bytes of a texel and of a result of `O`, the words a pass writes a texel: what a batch's
/// items and results take on the device.
pub(super) const fn sample_bytes<O>() -> (usize, usize) {
    (size_of::<[u32; 4]>(), size_of::<O>())
}

/// `scene`'s texels `rows` baked on `device` by pass `pass` of `passes`, the chains `library` holds
/// read from its pages, each batch's results — of `O`, the words the pass writes a texel — handed
/// to `write`, each with its texel.
pub(super) fn run<O: bytemuck::Pod>(
    device: &'static Device,
    (passes, pass): (&'static Passes, usize),
    (scene, library): (Scene, &Pages),
    rows: &[Vec<[u32; 4]>],
    cancelled: &AtomicBool,
    write: &mut dyn FnMut([u32; 4], &O),
) -> crate::Result<()> {
    let total: usize = rows.iter().map(Vec::len).sum();
    let (owned, chains) = scoped(device, || {
        // The copies into the bake's pages, then the uploads waited for.
        let mut encoder = device.wgpu().create_command_encoder(&Default::default());
        let textures = (SURFACES + scene.surfaces.len() / 4) as u32;
        let chains = bound(device, (library, &scene.chains), textures, &mut encoder)?;
        let mut head = scene.head;
        head[0][0] = textures;
        let materials: Vec<u32> = (head.into_iter().flatten().chain(super::frames::tables()))
            .chain(scene.surfaces.iter().copied())
            .chain(chains.records.iter().copied())
            .collect();
        let upload = |label: &str, words: &[u32]| -> crate::Result<wgpu::Buffer> {
            let bytes: &[u8] = bytemuck::cast_slice(words);
            let buffer = device.buffer(label, bytes.len() as u64, FILLED)?;
            device.queue().write_buffer(&buffer, 0, bytes);
            Ok(buffer)
        };
        let owned = Owned(vec![
            upload("scene", &scene.words)?,
            upload("materials", &materials)?,
        ]);
        device.submit(encoder, cancelled)?;
        Ok((owned, chains))
    })?;
    drop(scene);
    // The bindings in order: the chunk's uniform, the scene, the materials, the batch's texels and
    // results, then the pages.
    let layout = &passes.layout;
    let (scene_buffer, materials_buffer) = (owned.0[0].clone(), owned.0[1].clone());
    let pages = chains.pages.clone();
    let bind = move |params: &wgpu::Buffer, items: &wgpu::Buffer, results: &wgpu::Buffer| {
        let fixed = [params, &scene_buffer, &materials_buffer, items, results];
        device.bind("HLOD bake", layout, fixed.into_iter().chain(&pages))
    };
    let pipeline = &passes.pipelines[pass];
    let (item, result) = sample_bytes::<O>();
    let bytes = (item as u64, result as u64);
    let mut batches = Batches::new(device, pipeline, bytes, bind, (Vec::new(), cancelled))?;
    // The samples in order, once as each batch is made and once as its results return.
    let (mut making, mut landing) = (rows.iter().flatten().copied(), rows.iter().flatten());
    let mut make = |texels: &mut Vec<[u32; 4]>, count: usize| {
        texels.extend(making.by_ref().take(count));
    };
    let mut land = |results: &[O]| {
        for (result, sample) in results.iter().zip(landing.by_ref()) {
            write(*sample, result);
        }
    };
    batches.run(total, &mut make, &mut land)
}
