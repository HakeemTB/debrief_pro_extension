import * as vscode from 'vscode';

import { createProjectCommand, createTaskCommand, updateTaskStatusCommand } from './commands/projectCommands';
import { generateDebriefMarkdown } from './debrief/debriefReport';
import { DebriefProvider } from './providers/debriefProvider';
import { GitTracker } from './git/gitService';
import { LocalStorage, resolveStorageDirectory } from './storage/storage';

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function activate(context: vscode.ExtensionContext): void {
  const storage = new LocalStorage(resolveStorageDirectory(context.globalStorageUri.fsPath));
  storage.ensureReady();

  const provider = new DebriefProvider(storage);
  const treeView = vscode.window.createTreeView('debriefProSidebar', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  const gitTracker = new GitTracker(storage);

  const openSidebarCommand = vscode.commands.registerCommand('debriefpro.openSidebar', async () => {
    await vscode.commands.executeCommand('debriefProSidebar.focus');
  });

  const createProjectCommandHandler = vscode.commands.registerCommand('debriefpro.createProject', async () => {
    await createProjectCommand(storage);
    provider.refresh();
  });

  const createTaskCommandHandler = vscode.commands.registerCommand('debriefpro.createTask', async () => {
    await createTaskCommand(storage);
    provider.refresh();
  });

  const updateTaskStatusCommandHandler = vscode.commands.registerCommand('debriefpro.updateTaskStatus', async () => {
    await updateTaskStatusCommand(storage);
    provider.refresh();
  });

  const refreshGitCommandHandler = vscode.commands.registerCommand('debriefpro.refreshGit', async () => {
    await gitTracker.refresh();
    provider.refresh();
  });

  const generateDebriefCommandHandler = vscode.commands.registerCommand('debriefpro.generateDebrief', async () => {
    try {
      const allProjects = storage.getProjects();
      const projectChoices = [
        { label: 'Workspace overview', description: 'Aggregate all tracked work', projectId: undefined },
        ...allProjects.map((project) => ({ label: project.name, description: project.description || 'Project summary', projectId: project.id })),
      ];

      const selectedProject = await vscode.window.showQuickPick(projectChoices, {
        placeHolder: 'Select the scope for the debrief',
        ignoreFocusOut: true,
      });

      if (!selectedProject) {
        return;
      }

      const sessionId = selectedProject.projectId
        ? storage.getSessions()
            .filter((session) => session.projectId === selectedProject.projectId)
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]?.id
        : storage.getActiveSession()?.id;

      const markdown = generateDebriefMarkdown(storage, {
        projectId: selectedProject.projectId,
        sessionId,
        workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'No workspace folder selected',
      });

      const document = await vscode.workspace.openTextDocument({
        content: markdown,
        language: 'markdown',
      });

      await vscode.window.showTextDocument(document, {
        preview: true,
        viewColumn: vscode.ViewColumn.Active,
      });

      const saveUri = await vscode.window.showSaveDialog({
        filters: { 'Markdown files': ['md'] },
        defaultUri: vscode.Uri.file('debriefpro-debrief.md'),
        saveLabel: 'Export debrief',
      });

      if (!saveUri) {
        vscode.window.showInformationMessage('Debrief preview opened; export cancelled.');
        return;
      }

      await vscode.workspace.fs.writeFile(saveUri, Buffer.from(markdown, 'utf8'));
      vscode.window.showInformationMessage(`Debrief exported to ${saveUri.fsPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Unable to generate debrief: ${message}`);
    }
  });

  const startSessionCommandHandler = vscode.commands.registerCommand('debriefpro.startSession', async () => {
    const activeSession = storage.getActiveSession();
    if (activeSession && activeSession.state !== 'ended') {
      vscode.window.showWarningMessage(`A session is already active: ${activeSession.state}. Pause or end it before starting another.`);
      return;
    }

    const projects = storage.getProjects();
    if (projects.length === 0) {
      vscode.window.showWarningMessage('Create a project before starting a session.');
      return;
    }

    const project = await vscode.window.showQuickPick(
      projects.map((item) => ({ label: item.name, description: item.description, projectId: item.id })),
      { placeHolder: 'Select a project for the session', ignoreFocusOut: true },
    );

    if (!project) {
      return;
    }

    const tasks = storage.getTasksByProject(project.projectId);
    const taskChoice = tasks.length > 0
      ? await vscode.window.showQuickPick(
          [{ label: 'No specific task', description: 'General task focus', taskId: undefined }, ...tasks.map((task) => ({ label: task.title, description: `${task.status} · ${task.priority}`, taskId: task.id }))],
          { placeHolder: 'Select the current task', ignoreFocusOut: true },
        )
      : undefined;

    const session = storage.createSession(project.projectId, taskChoice?.taskId ?? undefined);
    vscode.window.showInformationMessage(`Session started for ${project.label}.`);
    provider.refresh();
    updateStatusBar();
  });

  const pauseSessionCommandHandler = vscode.commands.registerCommand('debriefpro.pauseSession', async () => {
    const active = storage.getActiveSession();
    if (!active) {
      vscode.window.showWarningMessage('No active session to pause.');
      return;
    }

    storage.addSessionEvent(active.id, 'paused');
    provider.refresh();
    updateStatusBar();
  });

  const resumeSessionCommandHandler = vscode.commands.registerCommand('debriefpro.resumeSession', async () => {
    const active = storage.getActiveSession();
    if (!active) {
      vscode.window.showWarningMessage('No paused session to resume.');
      return;
    }

    storage.addSessionEvent(active.id, 'resumed');
    provider.refresh();
    updateStatusBar();
  });

  const endSessionCommandHandler = vscode.commands.registerCommand('debriefpro.endSession', async () => {
    const active = storage.getActiveSession();
    if (!active) {
      vscode.window.showWarningMessage('No active or paused session to end.');
      return;
    }

    storage.addSessionEvent(active.id, 'ended');
    provider.refresh();
    updateStatusBar();
  });

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'debriefpro.openSidebar';
  statusBarItem.show();

  const updateStatusBar = () => {
    const activeSession = storage.getActiveSession();
    if (activeSession) {
      const elapsed = formatDuration(storage.getElapsedMilliseconds(activeSession));
      const task = activeSession.taskId ? storage.getTasks().find((item) => item.id === activeSession.taskId) : undefined;
      statusBarItem.text = activeSession.state === 'paused' ? `$(debug-pause) DebriefPro paused ${elapsed}` : `$(play) DebriefPro ${elapsed}`;
      statusBarItem.tooltip = `Session state: ${activeSession.state}${task ? ` · ${task.title}` : ''}`;
      return;
    }

    statusBarItem.text = '$(circle-large-outline) DebriefPro idle';
    statusBarItem.tooltip = 'No active session';
  };

  const statusTimer = setInterval(() => {
    const active = storage.getActiveSession();
    if (!active || active.state === 'ended') {
      return;
    }

    updateStatusBar();
    provider.refresh();
  }, 1000);

  const interruptedSessions = storage.getInterruptedSessions();
  if (interruptedSessions.length > 0) {
    vscode.window.showWarningMessage(`Recovered ${interruptedSessions.length} interrupted session(s). Review the active session before continuing.`);
  }

  context.subscriptions.push(
    treeView,
    openSidebarCommand,
    createProjectCommandHandler,
    createTaskCommandHandler,
    updateTaskStatusCommandHandler,
    refreshGitCommandHandler,
    generateDebriefCommandHandler,
    startSessionCommandHandler,
    pauseSessionCommandHandler,
    resumeSessionCommandHandler,
    endSessionCommandHandler,
    statusBarItem,
    { dispose: () => clearInterval(statusTimer) },
    ...gitTracker.registerListeners(),
  );

  void gitTracker.refresh();
  provider.refresh();
  updateStatusBar();
  vscode.window.showInformationMessage(`DebriefPro is active. ${storage.getProjects().length} project(s) are tracked locally.`);
}

export function deactivate(): void {
  // Intentionally empty. Extension cleanup is handled via subscriptions.
}
