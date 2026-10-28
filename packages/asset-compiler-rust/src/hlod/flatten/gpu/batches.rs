//! A pass run over a long list of invocations in batches, two at once: the CPU makes the next
//! batch's items while the device runs the one before, and reads the one before once the next is
//! sent (`Batches::run`); each pass dispatched in chunks timed to stay within any GPU's watchdog
//! (`submit.rs`). The shell's point queries (`approximate/gpu.rs`) and the atlas bake
//! (`bake/gpu/run.rs`) both go through it: what each binds beside the batch's buffers, and the
//! items and results it exchanges, are its own.
use super::layout::{BATCH, CHUNK, FILLED, READ_BACK, WORKGROUP, WRITTEN};
use super::{failed, scoped, Device, Pace, Reading};
use std::sync::atomic::AtomicBool;
use std::time::Instant;

/// A batch's buffers: the items, the results and their read-back — made for the largest batch the
/// slot sent, a batch at most, and reused by every batch after —, and their bind group.
struct Slot {
    count: usize,
    buffers: [wgpu::Buffer; 3],
    group: wgpu::BindGroup,
}

/// The invocations a slot made for `count` holds: the next power of two of them, `BATCH` at the
/// most.
fn slot_count(count: usize) -> usize {
    count.min(BATCH).next_power_of_two()
}

/// The bytes of a slot's three buffers — the items, the results and the results' read-back — made
/// for `count` invocations (`slot_count`), an item taking `bytes.0` and a result `bytes.1`.
fn slot_bytes(bytes: (u64, u64), count: usize) -> [u64; 3] {
    let slot = slot_count(count) as u64;
    let (items, results) = (slot.saturating_mul(bytes.0), slot.saturating_mul(bytes.1));
    [items, results, results]
}

/// The bytes a pass's two slots hold on the device for `samples` invocations, an item taking
/// `bytes.0` and a result `bytes.1`, the read-back of the results as much again (`slot_bytes`,
/// `Batches::hold`).
pub(crate) fn held_bytes(bytes: (usize, usize), samples: usize) -> usize {
    let slot = slot_bytes((bytes.0 as u64, bytes.1 as u64), samples);
    let both = slot
        .iter()
        .fold(0u64, |sum, &b| sum.saturating_add(b))
        .saturating_mul(2);
    usize::try_from(both).unwrap_or(usize::MAX)
}

/// A batch on the device: its slot, its invocations, its results' read-back asked for, and when it
/// was sent.
struct Flight {
    slot: usize,
    count: usize,
    reading: Reading,
    sent: Instant,
}

/// The bind group of a slot, made from the chunk's uniform, the slot's items and its results.
type Bind<'a> = Box<dyn Fn(&wgpu::Buffer, &wgpu::Buffer, &wgpu::Buffer) -> wgpu::BindGroup + 'a>;

/// A pass's batches on the device: the chunk's uniform and two slots, one batch on the device while
/// the next is made; the buffers the pass reads beside them, which the caller binds and this
/// destroys with the rest; the pace of its chunks, and whether its first batch measured it. All
/// destroyed when it drops.
pub(crate) struct Batches<'a> {
    device: &'static Device,
    pipeline: &'static wgpu::ComputePipeline,
    bind: Bind<'a>,
    params: wgpu::Buffer,
    kept: Vec<wgpu::Buffer>,
    /// The bytes an invocation's item and its result take.
    bytes: (u64, u64),
    slots: [Option<Slot>; 2],
    pace: Pace,
    paced: bool,
    /// Bytes all ones, as many as the largest batch's results, written over each batch's results
    /// before it runs when the pass asked (`mark_unwritten`); none otherwise.
    unwritten: Vec<u8>,
    cancelled: &'a AtomicBool,
}

impl<'a> Batches<'a> {
    /// The batches of `pipeline`, each invocation reading `bytes.0` bytes of items and writing
    /// `bytes.1` of results, its slots bound by `bind`, which is given the chunk's uniform, the
    /// slot's items and its results; `kept` the buffers it binds, destroyed with the batches; its
    /// waits stop when `cancelled` is raised.
    pub(crate) fn new(
        device: &'static Device,
        pipeline: &'static wgpu::ComputePipeline,
        bytes: (u64, u64),
        bind: impl Fn(&wgpu::Buffer, &wgpu::Buffer, &wgpu::Buffer) -> wgpu::BindGroup + 'a,
        (kept, cancelled): (Vec<wgpu::Buffer>, &'a AtomicBool),
    ) -> crate::Result<Self> {
        let params = match scoped(device, || device.buffer("chunk", 16, CHUNK)) {
            Ok(params) => params,
            Err(error) => {
                device.free(&kept);
                return Err(error);
            }
        };
        Ok(Self {
            device,
            pipeline,
            bind: Box::new(bind),
            params,
            kept,
            bytes,
            slots: [None, None],
            pace: Pace(WORKGROUP * 64),
            paced: false,
            unwritten: Vec::new(),
            cancelled,
        })
    }

    /// Every batch's results set to all ones before it runs: an invocation the device drops
    /// leaves its result so, where the pass can tell it from any it writes. Measured on an Apple
    /// GPU: a long batch lost whole SIMD groups of invocations now and then, no error raised, and
    /// their results kept what the slot's batch before had written.
    pub(crate) fn mark_unwritten(&mut self) {
        self.unwritten = vec![u8::MAX; (BATCH as u64 * self.bytes.1) as usize];
    }

    /// The buffers of slot `at` for `count` invocations, made anew — for the next power of two,
    /// within a batch — when the held ones are smaller, the smaller ones destroyed: the batch that
    /// used them last was read.
    fn hold(&mut self, at: usize, count: usize) -> crate::Result<()> {
        if self.slots[at]
            .as_ref()
            .is_some_and(|slot| slot.count >= count)
        {
            return Ok(());
        }
        if let Some(smaller) = self.slots[at].take() {
            self.device.free(&smaller.buffers);
        }
        let count = slot_count(count);
        let device = self.device;
        let [items, results, read_back] = slot_bytes(self.bytes, count);
        let buffers = [
            device.buffer("items", items, FILLED)?,
            device.buffer("results", results, WRITTEN)?,
            device.buffer("results read-back", read_back, READ_BACK)?,
        ];
        let group = (self.bind)(&self.params, &buffers[0], &buffers[1]);
        self.slots[at] = Some(Slot {
            count,
            buffers,
            group,
        });
        Ok(())
    }

    /// `count` invocations over the items `items` sent from slot `at`: uploaded, dispatched and
    /// their results' read-back asked for. The first batch measures the pace, chunk by chunk, each
    /// waited for (`Device::dispatch`); every batch after is sent whole in chunks of that pace,
    /// none waited for (`Device::send`).
    fn send(&mut self, at: usize, items: &[u8], count: usize) -> crate::Result<Flight> {
        let (device, cancelled) = (self.device, self.cancelled);
        let Some(slot) = &self.slots[at] else {
            return Err(failed("a batch's buffers were never made"));
        };
        let (pipeline, params, pace) = (self.pipeline, &self.params, &mut self.pace);
        let paced = std::mem::replace(&mut self.paced, true);
        let (sent, bytes) = (Instant::now(), count as u64 * self.bytes.1);
        let reading = scoped(device, || {
            device.queue().write_buffer(&slot.buffers[0], 0, items);
            if !self.unwritten.is_empty() {
                let ones = &self.unwritten[..bytes as usize];
                device.queue().write_buffer(&slot.buffers[1], 0, ones);
            }
            let group = &slot.group;
            if paced {
                device.send(pipeline, group, params, count, pace, cancelled)?;
            } else {
                device.dispatch(pipeline, group, params, count, pace, cancelled)?;
            }
            Ok(device.ask_read(&slot.buffers[1], &slot.buffers[2], bytes))
        })?;
        Ok(Flight {
            slot: at,
            count,
            reading,
            sent,
        })
    }

    /// The results of `flight` handed to `land` once its read-back is done, and when its copy was
    /// seen done; the device's time on it — from when the device could start it, once sent and the
    /// copy of the batch before it done (`free`), to its own copy's end — sizes the next chunks: a
    /// time stretched by other jobs' work only shortens them.
    fn land<O: bytemuck::Pod>(
        &mut self,
        flight: Flight,
        free: Instant,
        land: &mut dyn FnMut(&[O]),
    ) -> crate::Result<Instant> {
        let Flight {
            slot,
            count,
            reading,
            sent,
        } = flight;
        let (device, cancelled) = (self.device, self.cancelled);
        let Some(slot) = &self.slots[slot] else {
            return Err(failed("a batch's buffers were never made"));
        };
        let copied = scoped(device, || {
            device.read(reading, &slot.buffers[2], cancelled, &mut |bytes| {
                // Viewed in place where the mapping is aligned, copied once where it is not.
                match bytemuck::try_cast_slice::<u8, O>(bytes) {
                    Ok(results) => land(results),
                    Err(_) => land(&bytemuck::pod_collect_to_vec::<u8, O>(bytes)),
                }
            })
        })?;
        self.pace.next(count, copied.duration_since(sent.max(free)));
        Ok(copied)
    }

    /// The pass over `count` invocations, batch after batch: each batch's items made by `fill`,
    /// which appends the next `n` it is asked for, while the device runs the one before, then sent
    /// (`send`), then the one before read while the device runs it and its results handed to
    /// `land`, in order, as they return (`land`). The device always holds the next batch when it
    /// ends one, and the CPU's making and reading never stand between two.
    pub(crate) fn run<I: bytemuck::Pod, O: bytemuck::Pod>(
        &mut self,
        count: usize,
        fill: &mut dyn FnMut(&mut Vec<I>, usize),
        land: &mut dyn FnMut(&[O]),
    ) -> crate::Result<()> {
        let mut flying: Option<Flight> = None;
        // When the device could start the batch on it: once the copy of the one before it was
        // done, its last submission.
        let mut free = Instant::now();
        // One batch's items, reused: `send` copies them to the device before the next.
        let mut items: Vec<I> = Vec::with_capacity(count.min(BATCH));
        let (mut left, mut sent) = (count, 0);
        while left > 0 {
            let batch = left.min(BATCH);
            items.clear();
            fill(&mut items, batch);
            left -= batch;
            let at = sent % 2;
            self.hold(at, batch)?;
            let flight = self.send(at, bytemuck::cast_slice(&items), batch)?;
            sent += 1;
            if let Some(before) = flying.replace(flight) {
                free = self.land(before, free, &mut *land)?;
            }
        }
        if let Some(last) = flying {
            self.land(last, free, &mut *land)?;
        }
        Ok(())
    }
}

impl Drop for Batches<'_> {
    fn drop(&mut self) {
        let held = (self.slots.iter_mut())
            .filter_map(Option::take)
            .flat_map(|slot| slot.buffers);
        let all: Vec<wgpu::Buffer> = std::iter::once(self.params.clone())
            .chain(self.kept.drain(..))
            .chain(held)
            .collect();
        self.device.free(&all);
    }
}
