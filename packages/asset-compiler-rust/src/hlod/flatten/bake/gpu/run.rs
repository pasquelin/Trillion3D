//! One bake on the device: the scene, the materials and the pages uploaded once — the scene's words
//! let go once uploaded —; the texels sent in batches, two at once, as every pass of the device
//! runs (`flatten/gpu/batches.rs`: the CPU makes the next batch while the device runs the one
//! before, each batch read once the next is sent); each batch's results handed back as they
//! return. Every buffer of the bake, its own pages with them, is destroyed when it ends, however it
//! ends.
use super::chains::{bound, Pages};
use super::layout::SURFACES;
use super::scene::Scene;
use crate::hlod::flatten::gpu::layout::FILLED;
use crate::hlod::flatten::gpu::{scoped, Batches, Device, Owned, Passes};
use std::sync::atomic::AtomicBool;

/// The bytes a bake holds on the device per sample of a batch, in each of its two slots: its texel
/// (16), its result and the result's read-back (16 each).
pub(crate) const SAMPLE_BYTES: usize = 48;

/// `scene`'s texels `rows` baked on `device` by `passes`, the chains `library` holds read from its
/// pages, each batch's results handed to `write`, each with its texel.
pub(super) fn run(
    device: &'static Device,
    passes: &'static Passes,
    (scene, library): (Scene, &Pages),
    rows: &[Vec<[u32; 4]>],
    cancelled: &AtomicBool,
    write: &mut dyn FnMut([u32; 4], [u32; 4]),
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
    let pipeline = &passes.pipelines[0];
    let mut batches = Batches::new(device, pipeline, (16, 16), bind, (Vec::new(), cancelled))?;
    // The samples in order, once as each batch is made and once as its results return.
    let (mut making, mut landing) = (rows.iter().flatten().copied(), rows.iter().flatten());
    let mut make = |texels: &mut Vec<[u32; 4]>, count: usize| {
        texels.extend(making.by_ref().take(count));
    };
    let mut land = |results: &[[u32; 4]]| {
        for (result, sample) in results.iter().zip(landing.by_ref()) {
            write(*sample, *result);
        }
    };
    batches.run(total, &mut make, &mut land)
}
