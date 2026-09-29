// Prevents an extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod exec;
mod git;
mod mcp;
mod preview;
mod process;
mod search;
mod secrets;
mod symbols;
mod system_profile;
#[cfg(test)]
mod test_support;

use commands::ProjectState;
use mcp::McpState;
use preview::PreviewState;
use std::time::Duration;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ProjectState::default())
        .manage(PreviewState::default())
        .manage(McpState::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_project,
            commands::list_project_files,
            commands::read_project_file,
            system_profile::get_system_profile,
            git::git_status,
            git::git_init,
            git::write_project_files,
            git::delete_project_files,
            git::record_agent_change,
            git::list_agent_changes,
            secrets::set_provider_key,
            secrets::has_provider_key,
            secrets::get_provider_key,
            secrets::delete_provider_key,
            preview::start_preview,
            preview::stop_preview,
            preview::set_design_mode,
            search::search_project,
            symbols::file_symbols,
            exec::run_command,
            mcp::mcp_start,
            mcp::mcp_send,
            mcp::mcp_stop,
            mcp::mcp_stop_all
        ])
        .build(tauri::generate_context!())
        .expect("error while building Paleonyx Studio")
        .run(|app, event| {
            // Servers get their input closed, the polite way to ask, and
            // a moment to act on it; then whatever is left is ended.
            if let tauri::RunEvent::Exit = event {
                app.state::<McpState>()
                    .shutdown(Duration::from_millis(1500));
            }
        });
}
