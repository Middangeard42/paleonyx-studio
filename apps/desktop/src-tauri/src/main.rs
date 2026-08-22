// Prevents an extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod system_profile;

use commands::ProjectState;

fn main() {
    tauri::Builder::default()
        .manage(ProjectState::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_project,
            commands::list_project_files,
            commands::read_project_file,
            system_profile::get_system_profile
        ])
        .run(tauri::generate_context!())
        .expect("error while running Paleonyx Studio");
}
