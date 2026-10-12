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
      const changedFilesCount = repo.state?.workingTreeChanges?.length ?? 0;
      const commitId = head?.commit ?? undefined;
      const event = this.storage.createGitEvent({
        projectId: activeSession?.projectId,
        sessionId: activeSession?.id,
        repositoryPath,
        branchName,
        commitId,
        message: head ? `Git branch active: ${branchName}` : `Repository detected: ${repositoryPath}`,
        changedFilesCount,
        eventType: head ? 'branch' : 'repository',
        timestamp: new Date().toISOString(),
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
