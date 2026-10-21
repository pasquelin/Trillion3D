//! The sources' texture chains on the device. A library's chains go up once, before its first bake,
//! laid one after another into pages no larger than one binding, and are destroyed with the
//! library (`Library::pages`): every chain a bake reads is one of them, a source material's. A bake
//! binds the pages its chains lie in; when they pass its bindings, its chains are copied into pages
//! of its own instead (`bound`). Each chain's levels are addressed from its page's start.
use super::layout::{PIXEL_PAGES, TEXTURE_RECORDS};
use crate::hlod::flatten::bake::sources::Library;
use crate::hlod::flatten::gpu::{device, failed, scoped, Device, Owned};
use crate::trace::surface::material::Texels;
use std::collections::BTreeMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, PoisonError};

/// The staging an upload holds at most before it is flushed: the queue keeps a copy of each write
/// until the next submission ends.
const STAGING: u64 = 256 << 20;

/// Where each chain of a bake lies, its binding and its byte offset there, and the pages bound.
type Placed = (Vec<(usize, u64)>, Vec<wgpu::Buffer>);

/// A chain as laid in its pages: its page, its byte offset there, each level kept — its sides and
/// its offset from the chain's start —, the finest levels left out where the whole chain is larger
/// than one binding, its finest level's sides, whether it reads sRGB, and its bytes.
struct Chain {
    page: usize,
    offset: u64,
    levels: Vec<[u32; 3]>,
    skip: u32,
    sides: [u32; 2],
    srgb: bool,
    bytes: u64,
}

/// Chains on the device: each by the address of the chain it mirrors, and the pages' buffers,
/// destroyed when it drops.
pub(crate) struct Pages {
    chains: BTreeMap<usize, Chain>,
    buffers: Owned,
}

/// The key of `chain`: its address, never reused while the chain lives.
fn key(chain: &Arc<Texels>) -> usize {
    Arc::as_ptr(chain) as usize
}

/// `chain` laid at the end of `fill`, its finest levels left out until the rest fits a page of
/// `limit` bytes; a new page begun when the last has no room.
fn lay(chain: &Texels, limit: u64, fill: &mut Vec<u64>) -> crate::Result<Chain> {
    let levels = chain.levels();
    let size = |from: usize| -> u64 { levels[from..].iter().map(|l| l.2.len() as u64).sum() };
    let mut skip = 0;
    while skip + 1 < levels.len() && size(skip) > limit {
        skip += 1;
    }
    let bytes = size(skip);
    if bytes > limit {
        return Err(failed(
            "a texture's coarsest level is larger than one GPU binding",
        ));
    }
    if fill.last().is_none_or(|&used| used + bytes > limit) {
        fill.push(0);
    }
    let page = fill.len() - 1;
    let offset = fill[page];
    fill[page] += bytes;
    let mut at = 0u64;
    let mut kept = Vec::with_capacity(levels.len() - skip);
    for (width, height, texels) in &levels[skip..] {
        kept.push([*width as u32, *height as u32, at as u32]);
        at += texels.len() as u64;
    }
    Ok(Chain {
        page,
        offset,
        levels: kept,
        skip: skip as u32,
        sides: [levels[0].0 as u32, levels[0].1 as u32],
        srgb: chain.srgb(),
        bytes,
    })
}

impl Pages {
    /// `chains` laid and uploaded into pages, the staging flushed every `STAGING` bytes; the waits
    /// stop when `cancelled` is raised.
    fn new(
        device: &Device,
        chains: &[&Arc<Texels>],
        cancelled: &AtomicBool,
    ) -> crate::Result<Self> {
        let mut fill = Vec::new();
        let laid: Vec<Chain> = (chains.iter())
            .map(|chain| lay(chain, device.page_bytes(), &mut fill))
            .collect::<crate::Result<_>>()?;
        let usage = wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC;
        let usage = usage | wgpu::BufferUsages::COPY_DST;
        let buffers = Owned(
            (fill.iter())
                .map(|&bytes| device.buffer("texture page", bytes, usage))
                .collect::<crate::Result<_>>()?,
        );
        let flush = || {
            let encoder = device.wgpu().create_command_encoder(&Default::default());
            device.submit(encoder, cancelled).map(drop)
        };
        let mut staged = 0u64;
        for (chain, at) in chains.iter().zip(&laid) {
            let levels = &chain.levels()[at.skip as usize..];
            for ((_, _, texels), level) in levels.iter().zip(&at.levels) {
                let offset = at.offset + u64::from(level[2]);
                device
                    .queue()
                    .write_buffer(&buffers.0[at.page], offset, texels);
            }
            staged += at.bytes;
            if staged >= STAGING {
                flush()?;
                staged = 0;
            }
        }
        if staged > 0 {
            flush()?;
        }
        let chains = chains.iter().map(|c| key(c)).zip(laid).collect();
        Ok(Self { chains, buffers })
    }
}

impl Library {
    /// The library's chains on the device, uploaded the first time and kept until it drops.
    pub(crate) fn pages(&self) -> crate::Result<Arc<Pages>> {
        let mut held = self.resident.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(pages) = held.as_ref() {
            return Ok(pages.clone());
        }
        let device = device()?;
        let chains: Vec<&Arc<Texels>> = self.chains.iter().collect();
        let pages = scoped(device, || Pages::new(device, &chains, &self.cancelled))?;
        let pages = Arc::new(pages);
        *held = Some(pages.clone());
        Ok(pages)
    }
}

/// One bake's chains bound: their records, the pages bound in binding order, and what the bake
/// owns on the device — the copies, an empty page —, destroyed with it.
pub(super) struct Bound {
    pub records: Vec<u32>,
    pub pages: Vec<wgpu::Buffer>,
    _own: Owned,
}

/// The pages of `chains` for one bake, every one in `library`'s, and their records from
/// `textures`, the `vec4` rank of the first texture record in the materials: per chain its first
/// level's record, its kept levels, whether it reads sRGB and its binding, the levels it left out,
/// its finest sides; per level its word offset in its page and its sides. The copies into the
/// bake's own pages go to `encoder`, which the bake submits before its passes.
pub(super) fn bound(
    device: &Device,
    (library, chains): (&Pages, &[Arc<Texels>]),
    textures: u32,
    encoder: &mut wgpu::CommandEncoder,
) -> crate::Result<Bound> {
    let found: Vec<&Chain> = chains.iter().map(|c| &library.chains[&key(c)]).collect();
    // Each page read, in the order the chains first read it.
    let mut read: Vec<usize> = Vec::new();
    for chain in &found {
        if !read.contains(&chain.page) {
            read.push(chain.page);
        }
    }
    let mut owned = Vec::new();
    let (placed, mut pages): Placed = if read.len() <= PIXEL_PAGES {
        let placed = (found.iter())
            .map(|chain| {
                let page = read.iter().position(|&k| k == chain.page).unwrap_or(0);
                (page, chain.offset)
            })
            .collect();
        let pages = read.iter().map(|&k| library.buffers.0[k].clone()).collect();
        (placed, pages)
    } else {
        copied(device, (library, &found), encoder, &mut owned)?
    };
    if pages.len() < PIXEL_PAGES {
        let empty = device.buffer("texture page", 0, wgpu::BufferUsages::STORAGE)?;
        pages.resize(PIXEL_PAGES, empty.clone());
        owned.push(empty);
    }
    let mut level = textures + (found.len() * TEXTURE_RECORDS) as u32;
    let (mut records, mut levels) = (Vec::new(), Vec::new());
    for (&chain, &(page, offset)) in found.iter().zip(&placed) {
        let flags = u32::from(chain.srgb) | (page as u32) << 1;
        records.extend([level, chain.levels.len() as u32, flags, chain.skip]);
        records.extend([chain.sides[0], chain.sides[1], 0, 0]);
        for &[width, height, at] in &chain.levels {
            levels.extend([((offset + u64::from(at)) / 4) as u32, width, height, 0]);
        }
        level += chain.levels.len() as u32;
    }
    records.extend(levels);
    Ok(Bound {
        records,
        pages,
        _own: Owned(owned),
    })
}

/// The chains `found` of `library`'s pages copied into pages of the bake's own, each whole into
/// the first page with room, a page no larger than one binding; the copies recorded in `encoder`,
/// the pages added to `owned`. Each chain's page and offset, and the pages.
fn copied(
    device: &Device,
    (library, found): (&Pages, &[&Chain]),
    encoder: &mut wgpu::CommandEncoder,
    owned: &mut Vec<wgpu::Buffer>,
) -> crate::Result<Placed> {
    let limit = device.page_bytes();
    let mut fill = vec![0u64];
    let mut placed = Vec::with_capacity(found.len());
    for chain in found {
        if fill.last().is_some_and(|&used| used + chain.bytes > limit) {
            fill.push(0);
        }
        let page = fill.len() - 1;
        placed.push((page, fill[page]));
        fill[page] += chain.bytes;
    }
    if fill.len() > PIXEL_PAGES {
        let total: u64 = fill.iter().sum();
        return Err(failed(format!(
            "its sources' textures take {} MB, past the {PIXEL_PAGES} bindings of {} MB the GPU \
             binds at once",
            total >> 20,
            limit >> 20
        )));
    }
    let usage = wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST;
    let pages: Vec<wgpu::Buffer> = (fill.iter())
        .map(|&bytes| device.buffer("texture page", bytes, usage))
        .collect::<crate::Result<_>>()?;
    for (&chain, &(page, offset)) in found.iter().zip(&placed) {
        let source = &library.buffers.0[chain.page];
        encoder.copy_buffer_to_buffer(source, chain.offset, &pages[page], offset, chain.bytes);
    }
    owned.extend(pages.iter().cloned());
    Ok((placed, pages))
}
