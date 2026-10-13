import * as vscode from 'vscode';

import { GitEvent } from '../domain/models';
import { LocalStorage } from '../storage/storage';

export class GitTracker {
  constructor(private readonly storage: LocalStorage) {}

  public async refresh(): Promise<GitEvent[]> {
    const extension = vscode.extensions.getExtension('vscode.git');
    if (!extension) {
      return [];
    }

    const gitApi = (extension.exports as any).getAPI(1);
    const repositories = gitApi?.repositories ?? [];
    const activeSession = this.storage.getActiveSession();
    const events: GitEvent[] = [];

    for (const repo of repositories) {
      const repositoryPath = repo.rootUri?.fsPath ?? '';
      const head = repo.state?.HEAD;
      const branchName = head?.name ?? repo.state?.HEAD?.tracking ?? 'unknown';
      const fileChanges = [
        ...(repo.state?.indexChanges ?? []),
        ...(repo.state?.workingTreeChanges ?? []),
        ...(repo.state?.mergeChanges ?? []),
      ];
      const changedFiles = [...new Set(fileChanges
        .map((change: any) => {
          const filePath = change.uri?.fsPath ?? '';
          return filePath ? `${String(change.status)} ${filePath}` : '';
        })
        .filter(Boolean))].sort();
      const changedFilesCount = changedFiles.length;
      const commitId = head?.commit ?? undefined;
      const latest = this.storage.getGitEvents()
        .filter((event) => event.repositoryPath === repositoryPath)
        .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())[0];
      const unchanged = latest
        && latest.changedFiles !== undefined
        && latest.branchName === branchName
        && latest.commitId === commitId
        && JSON.stringify(latest.changedFiles) === JSON.stringify(changedFiles);
      if (unchanged) {
        continue;
      }

      const eventType = !latest
        ? head ? 'branch' : 'repository'
        : latest.commitId !== commitId ? 'commit'
          : latest.branchName !== branchName ? 'branch'
            : 'status';
      const event = this.storage.createGitEvent({
        projectId: activeSession?.projectId,
        sessionId: activeSession?.id,
        repositoryPath,
        branchName,
        commitId,
        message: eventType === 'commit'
          ? `Commit ${commitId?.slice(0, 8) ?? 'updated'} on ${branchName}`
          : eventType === 'status'
            ? `${changedFilesCount} changed file(s) on ${branchName}`
            : head ? `Git branch active: ${branchName}` : `Repository detected: ${repositoryPath}`,
        changedFilesCount,
        changedFiles,
        eventType,
        timestamp: new Date().toISOString(),
      });

      this.storage.createHistoryEvent({
        source: 'git',
        title: `Git ${event.eventType}: ${branchName}`,
        details: event.message ?? '',
        timestamp: event.timestamp,
        projectId: event.projectId,
        sessionId: event.sessionId,
        repositoryPath,
        commitId,
        changedFiles,
      });
      events.push(event);
    }

    return events;
  }

  public registerListeners(): vscode.Disposable[] {
    const extension = vscode.extensions.getExtension('vscode.git');
    if (!extension) {
      return [];
    }

    const gitApi = (extension.exports as any).getAPI(1);
    if (!gitApi) {
      return [];
    }

    const disposables: vscode.Disposable[] = [
      gitApi.onDidOpenRepository ? gitApi.onDidOpenRepository(() => void this.refresh()) : { dispose: () => undefined },
      gitApi.onDidChangeState ? gitApi.onDidChangeState(() => void this.refresh()) : { dispose: () => undefined },
    ];

    return disposables;
  }
}
