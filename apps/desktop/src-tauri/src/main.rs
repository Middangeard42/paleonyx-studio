// Prevents an extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod git;
mod secrets;
mod system_profile;

use commands::ProjectState;

fn main() {
    tauri::Builder::default()
        .manage(ProjectState::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_project,
            commands::list_project_files,
            commands::read_project_file,
            system_profile::get_system_profile,
            git::git_status,
            git::git_init,
            git::write_project_files,
            git::record_agent_change,
            git::list_agent_changes,
            secrets::set_provider_key,
            secrets::has_provider_key,
            secrets::get_provider_key,
            secrets::delete_provider_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running Paleonyx Studio");
}
