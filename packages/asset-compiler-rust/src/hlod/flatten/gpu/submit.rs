//! The device's submissions: each pass dispatched in chunks timed to stay well within any GPU's
//! watchdog, each job waiting for its own submissions only — learning each one's end from the
//! device's callback, the device polled between short naps (`HOLD`) that let a cancelled compile
//! stop, no wait holding the device — and no job waiting for another's, whose submissions the
//! device runs in between; read-backs asked for at once and read once their copy is done, so a job
//! sends its next batch first; and the error scopes a batch's work runs inside, so a refusal of
//! the device fails the step.
use super::layout::{BATCH, WORKGROUP};
use super::{failed, Device};
use crate::plugins::scene::cancel;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc::{Receiver, TryRecvError};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

/// What one submission should take: a fraction of the shortest watchdog (two seconds).
const TARGET: Duration = Duration::from_millis(200);
/// The nap a wait starts with between two looks at the device: short, so a small submission is
/// seen done at once.
const FIRST_NAP: Duration = Duration::from_micros(50);
/// The longest nap between two looks at the device and at the cancel token: each nap doubles up to
/// it. A look is a poll that takes no time; no wait holds the device across a nap, so a buffer's
/// destruction and every other job's submission and poll go on while one waits.
const HOLD: Duration = Duration::from_millis(2);
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

/// The end of a submission (`Device::launch`): the moment the device's callback ran, in the poll —
/// this job's or another's — that found the submission done; empty until then.
type Done = Arc<OnceLock<Instant>>;

/// A read-back asked for (`Device::ask_read`): the end of the copy's submission, the mapping's
/// outcome once its callback ran, and the bytes copied.
pub(crate) struct Reading {
    done: Done,
    mapped: Receiver<Result<(), wgpu::BufferAsyncError>>,
    bytes: u64,
}

impl Device {
    /// `run` — one submission or one poll — with the device's turn held (`Device::turn`): a poisoned
    /// turn guards nothing but the order, so it is taken all the same.
    fn turned<T>(&self, run: impl FnOnce() -> T) -> T {
        let _turn = self
            .turn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        run()
    }

    /// `encoder` submitted, the moment its turn was taken and the end it will raise: the callback
    /// is asked for in the same turn, so the submission it follows is this one.
    fn launch(&self, encoder: wgpu::CommandEncoder) -> (Instant, Done) {
        let done = Done::default();
        let raised = done.clone();
        let started = self.turned(|| {
            let started = Instant::now();
            self.queue.submit([encoder.finish()]);
            self.queue.on_submitted_work_done(move || {
                let _ = raised.set(Instant::now());
            });
            started
        });
        (started, done)
    }

    /// The device polled, a nap between two polls, until `ready` has an answer, stopping when
    /// `cancelled` is raised or the answer takes past `HUNG`. A poll runs the callbacks of every
    /// submission the device finds done, this job's or another's, and holds the turn for no time:
    /// other jobs submit, destroy their buffers and poll meanwhile, the device running their
    /// submissions between this job's.
    fn until<T>(
        &self,
        cancelled: &AtomicBool,
        mut ready: impl FnMut() -> crate::Result<Option<T>>,
    ) -> crate::Result<T> {
        let started = Instant::now();
        let mut nap = FIRST_NAP;
        loop {
            let polled = self.turned(|| self.device.poll(wgpu::PollType::Poll));
            if let Some(answer) = ready()? {
                return Ok(answer);
            }
            polled.map_err(failed)?;
            cancel::check(cancelled)?;
            if started.elapsed() >= HUNG {
                return Err(failed("the device never finished a submission"));
            }
            std::thread::sleep(nap);
            nap = (nap * 2).min(HOLD);
        }
    }

    /// The moment the device reported `done`, waited for (`until`).
    fn wait(&self, done: &Done, cancelled: &AtomicBool) -> crate::Result<Instant> {
        self.until(cancelled, || Ok(done.get().copied()))
    }

    /// `encoder` submitted and waited for; how long it took, from its turn to the device's report.
    pub(crate) fn submit(
        &self,
        encoder: wgpu::CommandEncoder,
        cancelled: &AtomicBool,
    ) -> crate::Result<Duration> {
        let (started, done) = self.launch(encoder);
        Ok(self.wait(&done, cancelled)?.duration_since(started))
    }

    /// The first `bytes` of `from` copied into `to` and mapped for reading, submitted and not
    /// waited for: `read` reads them once the copy is done.
    pub(crate) fn ask_read(&self, from: &wgpu::Buffer, to: &wgpu::Buffer, bytes: u64) -> Reading {
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.copy_buffer_to_buffer(from, 0, to, 0, bytes);
        let (sender, mapped) = std::sync::mpsc::channel();
        let (_, done) = self.launch(encoder);
        to.map_async(wgpu::MapMode::Read, ..bytes, move |outcome| {
            let _ = sender.send(outcome);
        });
        Reading {
            done,
            mapped,
            bytes,
        }
    }

    /// The bytes `reading` copied into `to`, seen by `read` once the copy is done and mapped; when
    /// the copy was seen done, the end of the work submitted before it and the moment the device
    /// could start the next submission. The mapping's callback runs in whichever job's poll finds
    /// the copy done first — this one's, or another's an instant later —: it is awaited the same
    /// way, the device polled between naps.
    pub(crate) fn read(
        &self,
        reading: Reading,
        to: &wgpu::Buffer,
        cancelled: &AtomicBool,
        read: &mut dyn FnMut(&[u8]),
    ) -> crate::Result<Instant> {
        let Reading {
            done,
            mapped,
            bytes,
        } = reading;
        let copied = self.wait(&done, cancelled)?;
        let outcome = self.until(cancelled, || match mapped.try_recv() {
            Ok(outcome) => Ok(Some(outcome)),
            Err(TryRecvError::Empty) => Ok(None),
            Err(TryRecvError::Disconnected) => Err(failed("a read-back never mapped")),
        })?;
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
        let _ = self.turned(|| self.device.poll(wgpu::PollType::Poll));
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
            self.turned(|| self.queue.submit([encoder.finish()]));
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
