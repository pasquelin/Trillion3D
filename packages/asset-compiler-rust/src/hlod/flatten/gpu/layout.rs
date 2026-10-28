//! What both programs lay out alike, written once: the workgroup, the batch, the buffers' uses,
//! the walk's stack, the constants put before a program's shaders, the bindings, and the compile
//! of a program into its passes.
use trillion3d_page_codec::proxy::PROXY_CHILDREN;

/// No child, no texture, no tree.
pub(crate) const NONE: u32 = u32::MAX;
/// Invocations per workgroup.
pub(crate) const WORKGROUP: usize = 64;
/// The invocations one batch holds, and the largest chunk a pass is dispatched in.
pub(crate) const BATCH: usize = 1 << 20;
/// A storage buffer the CPU fills.
pub(crate) const FILLED: wgpu::BufferUsages =
    wgpu::BufferUsages::STORAGE.union(wgpu::BufferUsages::COPY_DST);
/// A storage buffer the passes write and the CPU reads back, which the queue may fill beforehand
/// (`Batches::mark_unwritten`).
pub(crate) const WRITTEN: wgpu::BufferUsages = wgpu::BufferUsages::STORAGE
    .union(wgpu::BufferUsages::COPY_SRC)
    .union(wgpu::BufferUsages::COPY_DST);
/// A buffer the CPU maps to read what was copied into it.
pub(crate) const READ_BACK: wgpu::BufferUsages =
    wgpu::BufferUsages::MAP_READ.union(wgpu::BufferUsages::COPY_DST);
/// The uniform a chunk's first invocation and count go through.
pub(crate) const CHUNK: wgpu::BufferUsages =
    wgpu::BufferUsages::UNIFORM.union(wgpu::BufferUsages::COPY_DST);

/// The stack of a walk of a tree `depth` edges deep at most: each level of the path holds at most
/// `PROXY_CHILDREN − 1` siblings waiting, and the node in hand.
pub(crate) const fn stack(depth: usize) -> usize {
    (PROXY_CHILDREN - 1) * depth + 1
}

/// `constants` as WGSL `u32` constants, one line each.
pub(crate) fn wgsl_constants(constants: &[(&str, usize)]) -> String {
    (constants.iter())
        .map(|(name, value)| format!("const {name}: u32 = {value}u;\n"))
        .collect()
}

const fn binding(ty: wgpu::BufferBindingType) -> wgpu::BindingType {
    wgpu::BindingType::Buffer {
        ty,
        has_dynamic_offset: false,
        min_binding_size: None,
    }
}

/// A uniform binding: the chunk's.
pub(crate) const UNIFORM: wgpu::BindingType = binding(wgpu::BufferBindingType::Uniform);
/// A storage binding the passes read.
pub(crate) const READ: wgpu::BindingType =
    binding(wgpu::BufferBindingType::Storage { read_only: true });
/// A storage binding the passes write.
pub(crate) const WRITE: wgpu::BindingType =
    binding(wgpu::BufferBindingType::Storage { read_only: false });

/// What a program is compiled from: its label, its WGSL, its bindings in order from zero, and its
/// passes' entry points.
pub(crate) struct Source {
    pub label: &'static str,
    pub wgsl: String,
    pub bindings: Vec<wgpu::BindingType>,
    pub passes: &'static [&'static str],
}

/// A program compiled: its bind group's layout and its passes, in the order its source names them.
pub(crate) struct Passes {
    pub layout: wgpu::BindGroupLayout,
    pub pipelines: Vec<wgpu::ComputePipeline>,
}

/// `source` compiled on `device` within a validation scope, or why it did not compile.
pub(super) fn compile(device: &wgpu::Device, source: Source) -> Result<Passes, String> {
    let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(source.label),
        source: wgpu::ShaderSource::Wgsl(source.wgsl.into()),
    });
    let entries: Vec<wgpu::BindGroupLayoutEntry> = (source.bindings.iter().enumerate())
        .map(|(binding, &ty)| wgpu::BindGroupLayoutEntry {
            binding: binding as u32,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty,
            count: None,
        })
        .collect();
    let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some(source.label),
        entries: &entries,
    });
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some(source.label),
        bind_group_layouts: &[Some(&layout)],
        immediate_size: 0,
    });
    let pipelines = (source.passes.iter())
        .map(|&entry| {
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(entry),
                layout: Some(&pipeline_layout),
                module: &module,
                entry_point: Some(entry),
                compilation_options: Default::default(),
                cache: None,
            })
        })
        .collect();
    if let Some(error) = pollster::block_on(scope.pop()) {
        let label = source.label;
        return Err(format!("the {label} shader did not compile ({error})"));
    }
    Ok(Passes { layout, pipelines })
}
