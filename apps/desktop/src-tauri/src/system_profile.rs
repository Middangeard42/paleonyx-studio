use serde::Serialize;
use sysinfo::System;

/// Mirrors `SystemProfile` in packages/shared-types. Read-only by
/// construction — there is no corresponding write command, and this
/// module never touches anything outside process-local system queries.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemProfileDto {
    pub total_memory_bytes: u64,
    pub available_memory_bytes: u64,
    pub cpu_core_count: usize,
    /// `None` when no discrete/integrated adapter could be identified.
    pub gpu: Option<GpuInfoDto>,
    pub os: OsInfoDto,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfoDto {
    pub name: String,
    /// `None` when an adapter was found but its dedicated memory could
    /// not be read. The frontend treats that differently from "no GPU".
    pub vram_bytes: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsInfoDto {
    pub platform: String,
    pub version: String,
    pub arch: String,
}

#[tauri::command]
pub fn get_system_profile() -> SystemProfileDto {
    let mut system = System::new();
    system.refresh_memory();
    system.refresh_cpu_all();

    SystemProfileDto {
        total_memory_bytes: system.total_memory(),
        available_memory_bytes: system.available_memory(),
        // Physical cores are the meaningful figure for inference
        // throughput; fall back to the logical count if the platform
        // won't report physical.
        cpu_core_count: system
            .physical_core_count()
            .unwrap_or_else(|| system.cpus().len()),
        gpu: detect_gpu(),
        os: OsInfoDto {
            platform: std::env::consts::OS.to_string(),
            version: System::os_version().unwrap_or_else(|| "unknown".to_string()),
            arch: std::env::consts::ARCH.to_string(),
        },
    }
}

#[cfg(windows)]
fn detect_gpu() -> Option<GpuInfoDto> {
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
    };

    // SAFETY: DXGI adapter enumeration is a read-only query against the
    // graphics subsystem. Every call is checked; the loop ends on the
    // first error, which is how DXGI reports "no more adapters"
    // (DXGI_ERROR_NOT_FOUND).
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1().ok()?;
        let software_flag = DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32;
        let mut best: Option<GpuInfoDto> = None;

        for index in 0.. {
            let Ok(adapter) = factory.EnumAdapters1(index) else {
                break;
            };
            let Ok(desc) = adapter.GetDesc1() else {
                continue;
            };
            // The WARP software rasterizer enumerates like a real
            // adapter but would never run inference.
            if desc.Flags & software_flag != 0 {
                continue;
            }

            let name_end = desc
                .Description
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(desc.Description.len());
            let candidate = GpuInfoDto {
                name: String::from_utf16_lossy(&desc.Description[..name_end]),
                vram_bytes: Some(desc.DedicatedVideoMemory as u64),
            };

            // Prefer the adapter with the most dedicated memory: on
            // laptops the integrated adapter usually enumerates first,
            // but the discrete one is what actually matters here.
            let is_better = best
                .as_ref()
                .is_none_or(|current| {
                    candidate.vram_bytes.unwrap_or(0) > current.vram_bytes.unwrap_or(0)
                });
            if is_better {
                best = Some(candidate);
            }
        }

        best
    }
}

#[cfg(not(windows))]
fn detect_gpu() -> Option<GpuInfoDto> {
    // Unimplemented on macOS/Linux (see Cargo.toml). Reporting `None`
    // makes the frontend assess models as CPU-only, which is a pessimistic
    // but honest answer — better than inventing a VRAM figure.
    None
}
