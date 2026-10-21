//! The device opened: the adapter every native backend offers, chosen the same way on every run,
//! the limits the programs need and no more. Its programs are compiled when first asked for.
use super::Device;
use crate::hlod::flatten::bake::gpu::STORAGE_BUFFERS;

/// The device of the adapter Metal, Vulkan, Direct3D 12 or GL offers — high performance first,
/// then the backends' order, so one machine always runs on the same one —, opened with wgpu's
/// downlevel limits but for what the programs bind: the bake's storage buffers, the most any
/// binds, as large as the adapter holds them. No backend's own feature, no validation layer unless
/// the environment asks for one.
pub(super) fn open() -> Result<Device, String> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::VULKAN
            | wgpu::Backends::METAL
            | wgpu::Backends::DX12
            | wgpu::Backends::GL,
        flags: wgpu::InstanceFlags::empty().with_env(),
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let options = wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        ..Default::default()
    };
    let adapter = pollster::block_on(instance.request_adapter(&options))
        .map_err(|e| format!("no GPU adapter was found ({e})"))?;
    let offered = adapter.limits();
    let name = adapter.get_info().name;
    let compute = wgpu::DownlevelFlags::COMPUTE_SHADERS;
    if !adapter.get_downlevel_capabilities().flags.contains(compute) {
        return Err(format!("the adapter {name} runs no compute shader"));
    }
    if offered.max_storage_buffers_per_shader_stage < STORAGE_BUFFERS {
        return Err(format!(
            "the adapter {name} binds {} storage buffers, the bake needs {STORAGE_BUFFERS}",
            offered.max_storage_buffers_per_shader_stage
        ));
    }
    let descriptor = wgpu::DeviceDescriptor {
        label: Some("HLOD"),
        required_limits: wgpu::Limits {
            max_storage_buffers_per_shader_stage: STORAGE_BUFFERS,
            max_storage_buffer_binding_size: offered.max_storage_buffer_binding_size,
            max_buffer_size: offered.max_buffer_size,
            ..wgpu::Limits::downlevel_defaults()
        },
        ..Default::default()
    };
    let (device, queue) = pollster::block_on(adapter.request_device(&descriptor))
        .map_err(|e| format!("the adapter {name} opened no device ({e})"))?;
    Ok(Device {
        device,
        queue,
        programs: Default::default(),
    })
}
