import * as vscode from 'vscode';

import { Task } from '../domain/models';
import { LocalStorage } from '../storage/storage';

export async function createProjectCommand(storage: LocalStorage): Promise<void> {
  const projectName = await vscode.window.showInputBox({
    prompt: 'Project name',
    placeHolder: 'Example: DebriefPro extension',
    ignoreFocusOut: true,
  });

  if (!projectName || projectName.trim().length === 0) {
    return;
  }

  const projectDescription = await vscode.window.showInputBox({
    prompt: 'Project description',
    placeHolder: 'Short description of the project goal',
    ignoreFocusOut: true,
  });

  const created = storage.createProject({
    name: projectName.trim(),
    description: projectDescription?.trim() ?? '',
    objective: 'Track work, outcomes, and learning over the project lifecycle.',
    status: 'planned',
  });

  vscode.window.showInformationMessage(`Project created: ${created.name}`);
}

export async function createTaskCommand(storage: LocalStorage): Promise<void> {
  const projects = storage.getProjects();

  if (projects.length === 0) {
    vscode.window.showWarningMessage('Create a project before adding a task.');
    return;
  }

  const project = await vscode.window.showQuickPick(
    projects.map((item) => ({ label: item.name, description: item.description, projectId: item.id })),
    { placeHolder: 'Select a project for this task', ignoreFocusOut: true },
  );

  if (!project) {
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: 'Task title',
    placeHolder: 'Example: Implement session timeline view',
    ignoreFocusOut: true,
  });

  if (!title || title.trim().length === 0) {
    return;
  }

  const created = storage.createTask(project.projectId, {
    title: title.trim(),
    status: 'todo',
    priority: 'medium',
    estimateHours: 1,
  });

  vscode.window.showInformationMessage(`Task created: ${created.title}`);
}

export async function updateTaskStatusCommand(storage: LocalStorage): Promise<void> {
  const tasks = storage.getTasks();

  if (tasks.length === 0) {
    vscode.window.showWarningMessage('Create a task before updating its lifecycle state.');
    return;
  }

  const taskPick = await vscode.window.showQuickPick(
    tasks.map((task) => ({
      label: task.title,
      description: `${task.status} · ${task.priority} priority`,
      taskId: task.id,
    })),
    { placeHolder: 'Select a task to update', ignoreFocusOut: true },
  );

  if (!taskPick) {
    return;
  }

  const statusOptions: Task['status'][] = ['backlog', 'todo', 'in-progress', 'blocked', 'review', 'done'];
  const statusChoice = await vscode.window.showQuickPick(
    statusOptions.map((status) => ({ label: status, description: status === 'in-progress' ? 'Currently active' : undefined })),
    { placeHolder: 'Choose the task state', ignoreFocusOut: true },
  );

  if (!statusChoice) {
    return;
  }

  const updated = storage.updateTask(taskPick.taskId, {
    status: statusChoice.label as Task['status'],
    updatedAt: new Date().toISOString(),
  });

  if (!updated) {
    vscode.window.showErrorMessage('Unable to update task. The task no longer exists.');
    return;
  }

  vscode.window.showInformationMessage(`Task status updated: ${updated.title} → ${updated.status}`);
}
