# DebriefPro Commands

DebriefPro commands are available from the VS Code Command Palette. Open it with
`Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS, then search for
`DebriefPro`.

## Extension commands

| Command Palette title | Command ID | What it does |
| --- | --- | --- |
| DebriefPro: Open Sidebar | `debriefpro.openSidebar` | Opens the DebriefPro Overview view in the Activity Bar. |
| DebriefPro: Create Project | `debriefpro.createProject` | Creates a project with a name and optional description. |
| DebriefPro: Create Task | `debriefpro.createTask` | Creates a task under a selected project. |
| DebriefPro: Update Task Status | `debriefpro.updateTaskStatus` | Selects a task and changes its status. |
| DebriefPro: Start Session | `debriefpro.startSession` | Starts a work session for a selected project and optionally a task. Only one session can be active or paused at a time. |
| DebriefPro: Pause Session | `debriefpro.pauseSession` | Pauses the current session; paused time is excluded from focus time. |
| DebriefPro: Resume Session | `debriefpro.resumeSession` | Resumes a paused session. |
| DebriefPro: End Session | `debriefpro.endSession` | Ends the current active or paused session. |
| DebriefPro: Refresh Git Activity | `debriefpro.refreshGit` | Reads Git repository state and records a Git activity snapshot. |
| DebriefPro: Generate Debrief | `debriefpro.generateDebrief` | Previews a Markdown debrief for a project or workspace and offers to export it. |

### Task statuses

Tasks can be set to `backlog`, `todo`, `in-progress`, `blocked`, `review`, or
`done`.

## Sidebar

Select the DebriefPro icon in the Activity Bar to open **Overview**. The view
contains **Projects**, **Tasks**, **Session**, and **Debrief** sections. The
status bar also shows the current session state and elapsed focus time; select
it to open the sidebar.

## Build, test, package, and install

Run these commands from the DebriefPro project folder:

| Command | Purpose |
| --- | --- |
| `npm install` | Installs project dependencies. |
| `npm run compile` | Compiles the extension TypeScript into `out/`. |
| `npm test` | Compiles and runs the extension tests. |
| `npm run package` | Builds a distributable `.vsix` package. |
| `code --install-extension debriefpro-0.1.0.vsix` | Installs the generated package in VS Code. Replace the filename if the package version changes. |
| `code --uninstall-extension debriefpro.debriefpro` | Uninstalls DebriefPro from VS Code. |

To test changes in the Extension Development Host, open the project in VS Code
and press `F5`.
