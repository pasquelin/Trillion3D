//! The device's submissions: each pass dispatched in chunks timed to stay well within any GPU's
//! watchdog, each job waiting for its own submissions only, in steps that let a cancelled compile
//! stop — no job waits for another's, whose submissions the device runs in between; read-backs
//! asked for at once and read once their copy is done, so a job sends its next batch first; and
//! the error scopes a batch's work runs inside, so a refusal of the device fails the step.
use super::layout::{BATCH, WORKGROUP};
use super::{failed, Device};
use crate::plugins::scene::cancel;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

/// What one submission should take: a fraction of the shortest watchdog (two seconds).
const TARGET: Duration = Duration::from_millis(200);
/// The step a wait takes before it looks at the cancel token again.
const STEP: Duration = Duration::from_millis(250);
/// How long a submission may run before the device is taken as hung.
const HUNG: Duration = Duration::from_secs(60);

/// A pass's chunk, in invocations: the first small, each next sized from the time the last took.
pub(crate) struct Pace(pub(crate) usize);

impl Pace {
    pub(crate) fn next(&mut self, count: usize, took: Duration) {
        let rate = count as f64 / took.as_secs_f64().max(1e-4);
        let chunk = (rate * TARGET.as_secs_f64()) as usize;
        self.0 = chunk
            .clamp(WORKGROUP * 16, BATCH)
            .next_multiple_of(WORKGROUP);
    }
}

/// A read-back asked for (`Device::ask_read`): the copy's submission, the mapping's outcome once
/// its callback ran, and the bytes copied.
pub(crate) struct Reading {
    index: wgpu::SubmissionIndex,
    mapped: Receiver<Result<(), wgpu::BufferAsyncError>>,
    bytes: u64,
}

impl Device {
    /// Waits for submission `index`, a step at a time, stopping when `cancelled` is raised or the
    /// submission runs past `HUNG`. Other jobs submit and wait meanwhile: the device runs their
    /// submissions between this job's.
    fn wait(&self, index: wgpu::SubmissionIndex, cancelled: &AtomicBool) -> crate::Result<()> {
        let started = Instant::now();
        loop {
            let wait = wgpu::PollType::Wait {
                submission_index: Some(index.clone()),
                timeout: Some(STEP),
            };
            match self.device.poll(wait) {
                Ok(_) => return Ok(()),
                Err(wgpu::PollError::Timeout) if started.elapsed() < HUNG => {
                    cancel::check(cancelled)?
                }
                Err(error) => return Err(failed(error)),
            }
        }
    }

    /// `encoder` submitted and waited for; how long it took.
    pub(crate) fn submit(
        &self,
        encoder: wgpu::CommandEncoder,
        cancelled: &AtomicBool,
    ) -> crate::Result<Duration> {
        let started = Instant::now();
        let index = self.queue.submit([encoder.finish()]);
        self.wait(index, cancelled)?;
        Ok(started.elapsed())
    }

    /// The first `bytes` of `from` copied into `to` and mapped for reading, submitted and not
    /// waited for: `read` reads them once the copy is done.
    pub(crate) fn ask_read(&self, from: &wgpu::Buffer, to: &wgpu::Buffer, bytes: u64) -> Reading {
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.copy_buffer_to_buffer(from, 0, to, 0, bytes);
        let (sender, mapped) = std::sync::mpsc::channel();
        let index = self.queue.submit([encoder.finish()]);
        to.map_async(wgpu::MapMode::Read, ..bytes, move |outcome| {
            let _ = sender.send(outcome);
        });
        Reading {
            index,
            mapped,
            bytes,
        }
    }

    /// The bytes `reading` copied into `to`, seen by `read` once the copy is done and mapped; when
    /// the copy was seen done, the end of the work submitted before it and the moment the device
    /// could start the next submission. The mapping's callback runs in whichever job's poll finds
    /// the copy done first — this one's, or another's an instant later —: it is awaited a step at
    /// a time, the device polled between.
    pub(crate) fn read(
        &self,
        reading: Reading,
        to: &wgpu::Buffer,
        cancelled: &AtomicBool,
        read: &mut dyn FnMut(&[u8]),
    ) -> crate::Result<Instant> {
        let Reading {
            index,
            mapped,
            bytes,
        } = reading;
        self.wait(index, cancelled)?;
        let copied = Instant::now();
        let outcome = loop {
            match mapped.recv_timeout(STEP) {
                Ok(outcome) => break outcome,
                Err(RecvTimeoutError::Timeout) if copied.elapsed() < HUNG => {
                    cancel::check(cancelled)?;
                    let _ = self.device.poll(wgpu::PollType::Poll);
                }
                Err(_) => return Err(failed("a read-back never mapped")),
            }
        };
        outcome.map_err(failed)?;
        read(&to.get_mapped_range(..bytes).map_err(failed)?);
        to.unmap();
        Ok(copied)
    }

    /// `buffers` destroyed now and the device polled once: their memory goes back at once. Every
    /// submission that reads them was waited for, so none still does.
    pub(crate) fn free(&self, buffers: &[wgpu::Buffer]) {
        if buffers.is_empty() {
            return;
        }
        buffers.iter().for_each(wgpu::Buffer::destroy);
        let _ = self.device.poll(wgpu::PollType::Poll);
    }

    /// The encoder of `pass` over the invocations `first..first + chunk`, its uniform written:
    /// the queue writes it before the encoder's submission, after every submission before it.
    fn chunk(
        &self,
        (pass, group, params): (&wgpu::ComputePipeline, &wgpu::BindGroup, &wgpu::Buffer),
        first: usize,
        chunk: usize,
    ) -> wgpu::CommandEncoder {
        let words = [first as u32, chunk as u32, 0, 0];
        self.queue
            .write_buffer(params, 0, bytemuck::cast_slice(&words));
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let mut compute = encoder.begin_compute_pass(&Default::default());
            compute.set_pipeline(pass);
            compute.set_bind_group(0, group, &[]);
            compute.dispatch_workgroups(chunk.div_ceil(WORKGROUP) as u32, 1, 1);
        }
        encoder
    }

    /// `pass` dispatched over `count` invocations in chunks, each waited for, `pace` sizing each
    /// from the time the one before took.
    pub(crate) fn dispatch(
        &self,
        pass: &wgpu::ComputePipeline,
        group: &wgpu::BindGroup,
        params: &wgpu::Buffer,
        count: usize,
        pace: &mut Pace,
        cancelled: &AtomicBool,
    ) -> crate::Result<()> {
        let mut first = 0;
        while first < count {
            cancel::check(cancelled)?;
            let chunk = (count - first).min(pace.0);
            let took = self.submit(self.chunk((pass, group, params), first, chunk), cancelled)?;
            pace.next(chunk, took);
            first += chunk;
        }
        Ok(())
    }

    /// `pass` sent over `count` invocations in the chunks `pace` sizes, none waited for: they run
    /// one behind the other while the job prepares its next batch, each as short as a waited one.
    pub(crate) fn send(
        &self,
        pass: &wgpu::ComputePipeline,
        group: &wgpu::BindGroup,
        params: &wgpu::Buffer,
        count: usize,
        pace: &Pace,
        cancelled: &AtomicBool,
    ) -> crate::Result<()> {
        let mut first = 0;
        while first < count {
            cancel::check(cancelled)?;
            let chunk = (count - first).min(pace.0);
            let encoder = self.chunk((pass, group, params), first, chunk);
            self.queue.submit([encoder.finish()]);
            first += chunk;
        }
        Ok(())
    }
}

/// The scopes every batch's work runs in, popped in turn: the first error any caught, unless the
/// work was cancelled.
pub(crate) fn scoped<T>(
    device: &Device,
    work: impl FnOnce() -> crate::Result<T>,
) -> crate::Result<T> {
    let filters = [
        wgpu::ErrorFilter::OutOfMemory,
        wgpu::ErrorFilter::Internal,
        wgpu::ErrorFilter::Validation,
    ];
    let scopes = filters.map(|filter| device.device.push_error_scope(filter));
    let done = work();
    let mut caught = None;
    for scope in scopes.into_iter().rev() {
        caught = caught.or(pollster::block_on(scope.pop()));
    }
    match caught {
        Some(_) if matches!(&done, Err(e) if e.code == crate::CANCELLED) => done,
        Some(error) => Err(failed(error)),
        None => done,
    }
}
