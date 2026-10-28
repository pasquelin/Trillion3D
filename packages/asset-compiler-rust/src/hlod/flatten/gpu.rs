//! The compile's one GPU: one headless device per process, opened the first time an HLOD step
//! needs it and shared by every job (`open`). Each job packs, uploads, submits and waits for its
//! own work while others do theirs: no job waits for another's submissions, which the device runs
//! between its own (`submit`). Three programs run on it, each compiled the first time it is asked
//! for and kept with the device: the atlas bake (`bake/gpu.rs`), of an approximated shell's atlas
//! and of a merged or simplified layer's flattened materials, the approximated shell's point
//! queries (`approximate/gpu.rs`), and the voxels of a mesh's distance field
//! (`distance_field/gpu.rs`).
//! What they share — the layout's common constants, the bindings, the compile, the packing of
//! positions and tree links, and the batches a pass runs in, two at once (`batches`) — is written
//! once here (`layout`, `pack`, `batches`).
//!
//! Every large buffer is destroyed as soon as its job is done with it (`Owned`), the device then
//! polled: a dropped buffer would wait for some later poll to give its memory back.
//!
//! Without an adapter no HLOD can be built: the compile fails with `GPU_UNAVAILABLE`. The device
//! is opened once per process and never again: lost, every later bake or query of the process
//! fails with `GPU_BAKE_FAILED`, as does a program that does not compile. A distance field is the
//! one step that does not need it: its build falls back to the CPU's (`distance_field/build.rs`).
use std::sync::OnceLock;
mod batches;
pub(crate) mod layout;
mod open;
pub(crate) mod pack;
mod submit;
pub(crate) use batches::{held_bytes, unwritten_bytes, Batches};
pub(crate) use layout::{Passes, Source};
pub(crate) use submit::{scoped, Pace, Reading};

/// The programs the device runs, each compiled once (`Device::passes`).
#[derive(Clone, Copy)]
pub(crate) enum Program {
    Bake = 0,
    Shell = 1,
    DistanceField = 2,
}

/// The process's device: its queue and its programs as compiled.
pub(crate) struct Device {
    device: wgpu::Device,
    queue: wgpu::Queue,
    programs: [OnceLock<Result<Passes, String>>; 3],
    /// Taken by each submission and each poll, and by nothing longer: a poll is one look at the
    /// device that takes no time (`Poll`, never a wait on it), so its maintenance never runs beside
    /// another job's submission — the device's own checks assume a queue it finds empty has finished
    /// what it saw done, which a submission in between breaks — while a wait is naps between polls,
    /// the turn free (`submit`).
    turn: std::sync::Mutex<()>,
}

/// `bytes` of the device's buffers as an admission counts them: all where the process's measure of
/// its memory holds them (`rss::counts_device_buffers`), none where it does not — an estimate
/// follows what the measure reads.
pub(crate) fn counted(bytes: usize) -> usize {
    if crate::support::perf::rss::counts_device_buffers() {
        bytes
    } else {
        0
    }
}

impl Device {
    /// The device itself.
    pub(crate) fn wgpu(&self) -> &wgpu::Device {
        &self.device
    }

    /// Its queue.
    pub(crate) fn queue(&self) -> &wgpu::Queue {
        &self.queue
    }

    /// The passes of `program`, compiled from `source` the first time — tried once, never again —,
    /// or why they could not be.
    pub(crate) fn passes(
        &self,
        program: Program,
        source: impl FnOnce() -> Source,
    ) -> crate::Result<&Passes> {
        let compiled =
            self.programs[program as usize].get_or_init(|| layout::compile(&self.device, source()));
        compiled.as_ref().map_err(failed)
    }

    /// The largest page: one storage binding, in whole words.
    pub(crate) fn page_bytes(&self) -> u64 {
        let limits = self.device.limits();
        (limits
            .max_storage_buffer_binding_size
            .min(limits.max_buffer_size))
            & !3
    }

    /// A buffer of `bytes` bytes, at least 256 so no binding falls below its shader's least size,
    /// refused past the adapter's largest buffer.
    pub(crate) fn buffer(
        &self,
        label: &str,
        bytes: u64,
        usage: wgpu::BufferUsages,
    ) -> crate::Result<wgpu::Buffer> {
        let size = bytes.max(256).next_multiple_of(wgpu::COPY_BUFFER_ALIGNMENT);
        let largest = self.device.limits().max_buffer_size;
        if size > largest {
            return Err(failed(format!(
                "its {label} take {} MB, past the GPU's largest buffer, {} MB",
                size >> 20,
                largest >> 20
            )));
        }
        Ok(self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(label),
            size,
            usage,
            mapped_at_creation: false,
        }))
    }

    /// The bind group of `layout` binding `buffers` whole, in their order from binding zero.
    pub(crate) fn bind<'a>(
        &self,
        label: &str,
        layout: &wgpu::BindGroupLayout,
        buffers: impl IntoIterator<Item = &'a wgpu::Buffer>,
    ) -> wgpu::BindGroup {
        let entries: Vec<wgpu::BindGroupEntry> = (buffers.into_iter().enumerate())
            .map(|(binding, buffer)| wgpu::BindGroupEntry {
                binding: binding as u32,
                resource: buffer.as_entire_binding(),
            })
            .collect();
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(label),
            layout,
            entries: &entries,
        })
    }
}

/// Buffers destroyed when dropped, the device then polled (`Device::free`).
pub(crate) struct Owned(pub(crate) Vec<wgpu::Buffer>);

impl Drop for Owned {
    fn drop(&mut self) {
        if let Some(Ok(device)) = DEVICE.get() {
            device.free(&self.0);
        }
    }
}

/// The process's one device, or why it could not be opened: tried once, never again.
static DEVICE: OnceLock<Result<Device, String>> = OnceLock::new();

/// The device, opened the first time — or why it could not be.
pub(crate) fn device() -> crate::Result<&'static Device> {
    DEVICE.get_or_init(open::open).as_ref().map_err(|reason| {
        crate::CompilerError::new(
            "GPU_UNAVAILABLE",
            format!("HLOD building needs a GPU: {reason}"),
        )
    })
}

/// A failure on the device, of a bake or of a shell's queries.
pub(crate) fn failed(reason: impl std::fmt::Display) -> crate::CompilerError {
    crate::CompilerError::new(
        "GPU_BAKE_FAILED",
        format!("an HLOD step failed on the GPU: {reason}"),
    )
}
