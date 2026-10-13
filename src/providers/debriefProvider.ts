import * as vscode from 'vscode';

import { LocalStorage } from '../storage/storage';

export class DebriefProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly storage: LocalStorage) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    if (!element) {
      return [
        this.createSection('Projects', 'Planned and active work', vscode.TreeItemCollapsibleState.Collapsed),
        this.createSection('Tasks', 'Next actions and blocked work', vscode.TreeItemCollapsibleState.Collapsed),
        this.createSection('Session', 'Current session', vscode.TreeItemCollapsibleState.Collapsed),
        this.createSection('Debrief', 'Latest summary', vscode.TreeItemCollapsibleState.None),
        this.createSection('History', 'Recent app and source changes', vscode.TreeItemCollapsibleState.Collapsed),
      ];
    }

    if (element.label === 'Projects') {
      const projects = this.storage.getProjects();
      return projects.length === 0
        ? [this.createLeaf('No projects yet', 'Create one to begin tracking work.')]
        : projects.map((project) => {
            const item = this.createLeaf(project.name, project.status);
            item.description = project.description || 'No description yet';
            item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
            item.contextValue = 'project';
            return item;
          });
    }

    if (element.label === 'Tasks') {
      const allTasks = this.storage.getTasks();
      return allTasks.length === 0
        ? [this.createLeaf('No tasks yet', 'Add a task to begin tracking execution.')]
        : allTasks.map((task) => {
            const item = this.createLeaf(task.title, task.status);
            item.description = `${task.priority} priority · ${task.estimateHours ?? 0}h`;
            item.contextValue = 'task';
            return item;
          });
    }

    if (element.label === 'Session') {
      const session = this.storage.getActiveSession();
      if (!session) {
        return [this.createLeaf('No active session', 'Start a session to capture focus time.')];
      }

      const project = this.storage.getProjects().find((item) => item.id === session.projectId);
      const task = session.taskId ? this.storage.getTasks().find((item) => item.id === session.taskId) : undefined;
      const elapsedMinutes = Math.max(0, Math.round(this.storage.getElapsedMilliseconds(session) / (60 * 1000)));

      return [
        this.createLeaf('State', session.state),
        this.createLeaf('Project', project?.name ?? 'Unknown project'),
        this.createLeaf('Task', task?.title ?? 'No specific task'),
        this.createLeaf('Focus time', `${elapsedMinutes} minutes`),
        this.createLeaf('Updated', new Date(session.updatedAt).toLocaleString()),
      ];
    }

    if (element.label === 'Debrief') {
      const debrief = this.storage.getDebriefSummary();
      return [
        this.createLeaf('Summary', debrief.summary),
        this.createLeaf('Projects', `${debrief.projectCount}`),
        this.createLeaf('Completed tasks', `${debrief.completedTaskCount}`),
        this.createLeaf('Focus time', `${debrief.totalSessionMinutes} minutes`),
        this.createLeaf('Git activity', `${debrief.gitEventCount} updates`),
      ];
    }

    if (element.label === 'History') {
      const history = this.storage.getHistoryEvents().slice(0, 50);
      return history.length === 0
        ? [this.createLeaf('No history yet', 'Project, task, session, and Git changes will appear here.')]
        : history.map((event) => {
            const item = new vscode.TreeItem(event.title, vscode.TreeItemCollapsibleState.Collapsed);
            item.id = event.id;
            item.description = `${event.source} · ${new Date(event.timestamp).toLocaleString()}`;
            item.tooltip = event.details;
            item.contextValue = 'historyEvent';
            return item;
          });
    }

    if (element.contextValue === 'historyEvent') {
      const event = this.storage.getHistoryEvents().find((item) => item.id === element.id);
      if (!event) {
        return [];
      }

      const details = [this.createLeaf('Details', event.details || 'No additional details')];
      if (event.commitId) {
        details.push(this.createLeaf('Commit', event.commitId));
      }
      if (event.repositoryPath) {
        details.push(this.createLeaf('Repository', event.repositoryPath));
      }
      for (const changedFile of event.changedFiles ?? []) {
        details.push(this.createLeaf('File', changedFile));
      }
      return details;
    }

    if (element.contextValue === 'project') {
      const projectName = String(element.label);
      const project = this.storage.getProjects().find((item) => item.name === projectName);
      if (!project) {
        return [];
      }

      const tasks = this.storage.getTasksByProject(project.id);
      return tasks.length === 0
        ? [this.createLeaf('No tasks for this project', 'Add a task from the command palette.')]
        : tasks.map((task) => {
            const item = this.createLeaf(task.title, task.status);
            item.description = `${task.priority} priority · ${task.estimateHours ?? 0}h`;
            item.contextValue = 'task';
            return item;
          });
    }

    if (element.contextValue === 'task') {
      const taskTitle = String(element.label);
      const task = this.storage.getTasks().find((item) => item.title === taskTitle);
      if (!task) {
        return [];
      }

      return [
        this.createLeaf('Priority', task.priority),
        this.createLeaf('Estimate', `${task.estimateHours ?? 0}h`),
        this.createLeaf('Updated', new Date(task.updatedAt).toLocaleString()),
      ];
    }

    return [];
  }

  private createSection(label: string, description: string, collapsibleState: vscode.TreeItemCollapsibleState): vscode.TreeItem {
    const item = new vscode.TreeItem(label, collapsibleState);
    item.description = description;
    item.contextValue = 'section';
    return item;
  }

  private createLeaf(label: string, description: string): vscode.TreeItem {
    const item = new vscode.TreeItem(label);
    item.description = description;
    item.contextValue = 'leaf';
    return item;
  }
}
