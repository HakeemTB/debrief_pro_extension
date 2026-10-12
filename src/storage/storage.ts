import * as fs from 'fs';
import * as path from 'path';

import { GitEvent, Project, SessionEvent, SessionState, Task, WorkSession } from '../domain/models';

export interface StorageData {
  projects: Project[];
  tasks: Task[];
  sessions: WorkSession[];
  gitEvents: GitEvent[];
}

export interface DebriefSummary {
  projectCount: number;
  taskCount: number;
  completedTaskCount: number;
  totalSessionMinutes: number;
  gitEventCount: number;
  latestBranchName?: string;
  summary: string;
}

export class LocalStorage {
  private readonly filePath: string;

  constructor(globalStoragePath: string) {
    this.filePath = path.join(globalStoragePath, 'debriefpro-storage.json');
  }

  ensureReady(): void {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });

    if (!fs.existsSync(this.filePath)) {
      const initial: StorageData = { projects: [], tasks: [], sessions: [], gitEvents: [] };
      fs.writeFileSync(this.filePath, JSON.stringify(initial, null, 2), 'utf8');
    }
  }

  readData(): StorageData {
    this.ensureReady();

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StorageData>;

      return {
        projects: Array.isArray(parsed.projects) ? (parsed.projects as Project[]) : [],
        tasks: Array.isArray(parsed.tasks) ? (parsed.tasks as Task[]) : [],
        sessions: Array.isArray(parsed.sessions) ? (parsed.sessions as WorkSession[]) : [],
        gitEvents: Array.isArray(parsed.gitEvents) ? (parsed.gitEvents as GitEvent[]) : [],
      };
    } catch {
      return { projects: [], tasks: [], sessions: [], gitEvents: [] };
    }
  }

  writeData(data: StorageData): void {
    this.ensureReady();
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  getProjects(): Project[] {
    return this.readData().projects;
  }

  getTasks(): Task[] {
    return this.readData().tasks;
  }

  getSessions(): WorkSession[] {
    return this.readData().sessions;
  }

  getGitEvents(): GitEvent[] {
    return this.readData().gitEvents;
  }

  getActiveSession(): WorkSession | undefined {
    const sessions = this.getSessions();
    return sessions
      .filter((session) => session.state === 'active' || session.state === 'paused')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  }

  getInterruptedSessions(maxIdleMs = 30 * 60 * 1000): WorkSession[] {
    const cutoff = Date.now() - maxIdleMs;
    return this.getSessions().filter((session) => {
      const isOpen = session.state === 'active' || session.state === 'paused';
      const isStale = new Date(session.updatedAt).getTime() < cutoff;
      return isOpen && isStale;
    });
  }

  updateSessionTimestamp(sessionId: string, updatedAt: string): WorkSession | undefined {
    const data = this.readData();
    const session = data.sessions.find((item) => item.id === sessionId);
    if (!session) {
      return undefined;
    }

    session.updatedAt = updatedAt;
    this.writeData(data);
    return session;
  }

  getTasksByProject(projectId: string): Task[] {
    return this.readData().tasks.filter((task) => task.projectId === projectId);
  }

  updateTask(taskId: string, updates: Partial<Task>): Task | undefined {
    const data = this.readData();
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task) {
      return undefined;
    }

    Object.assign(task, updates, { updatedAt: updates.updatedAt ?? new Date().toISOString() });
    this.writeData(data);
    return task;
  }

  createProject(input: Partial<Project>): Project {
    const data = this.readData();
    const now = new Date().toISOString();
    const nextProject: Project = {
      id: input.id ?? `project-${Date.now()}`,
      name: input.name ?? 'Untitled project',
      description: input.description ?? '',
      objective: input.objective ?? '',
      notes: input.notes ?? '',
      status: input.status ?? 'planned',
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };

    data.projects.push(nextProject);
    this.writeData(data);
    return nextProject;
  }

  createTask(projectId: string, input: Partial<Task>): Task {
    const data = this.readData();
    const now = new Date().toISOString();
    const nextTask: Task = {
      id: input.id ?? `task-${Date.now()}`,
      projectId,
      title: input.title ?? 'Untitled task',
      status: input.status ?? 'todo',
      priority: input.priority ?? 'medium',
      estimateHours: input.estimateHours ?? 0,
      notes: input.notes ?? '',
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };

    data.tasks.push(nextTask);
    this.writeData(data);
    return nextTask;
  }

  createSession(projectId: string, taskId?: string, notes?: string): WorkSession {
    const data = this.readData();
    const now = new Date().toISOString();
    const sessionId = `session-${Date.now()}`;
    const session: WorkSession = {
      id: sessionId,
      projectId,
      taskId,
      notes: notes ?? '',
      state: 'active',
      startedAt: now,
      updatedAt: now,
      events: [{ id: `event-${Date.now()}`, sessionId, type: 'started', timestamp: now }],
    };

    data.sessions.push(session);
    this.writeData(data);
    return session;
  }

  addSessionEvent(sessionId: string, type: SessionEvent['type']): WorkSession | undefined {
    const data = this.readData();
    const session = data.sessions.find((item) => item.id === sessionId);

    if (!session) {
      return undefined;
    }

    const allowedTransitions: Record<SessionEvent['type'], SessionState[]> = {
      started: ['idle', 'ended'],
      paused: ['active'],
      resumed: ['paused'],
      ended: ['active', 'paused'],
    };

    if (!allowedTransitions[type]?.includes(session.state)) {
      return session;
    }

    const now = new Date().toISOString();
    session.events.push({
      id: `event-${Date.now()}`,
      sessionId,
      type,
      timestamp: now,
    });

    switch (type) {
      case 'started':
        session.state = 'active';
        session.startedAt = now;
        session.endedAt = undefined;
        break;
      case 'paused':
        session.state = 'paused';
        break;
      case 'resumed':
        session.state = 'active';
        break;
      case 'ended':
        session.state = 'ended';
        session.endedAt = now;
        break;
    }

    session.updatedAt = now;
    this.writeData(data);
    return session;
  }

  getElapsedMilliseconds(session: WorkSession): number {
    const start = new Date(session.startedAt).getTime();
    const end = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
    const sortedEvents = [...session.events].sort(
      (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
    );

    let pauseStartedAt: number | undefined;
    let pausedDuration = 0;

    for (const event of sortedEvents) {
      const timestamp = new Date(event.timestamp).getTime();

      if (event.type === 'paused') {
        if (pauseStartedAt === undefined) {
          pauseStartedAt = timestamp;
        }
      } else if (event.type === 'resumed') {
        if (pauseStartedAt !== undefined) {
          pausedDuration += timestamp - pauseStartedAt;
          pauseStartedAt = undefined;
        }
      } else if (event.type === 'ended') {
        if (pauseStartedAt !== undefined) {
          pausedDuration += timestamp - pauseStartedAt;
          pauseStartedAt = undefined;
        }
      }
    }

    return Math.max(0, end - start - pausedDuration);
  }

  createGitEvent(input: Partial<GitEvent>): GitEvent {
    const data = this.readData();
    const now = new Date().toISOString();
    const newEvent: GitEvent = {
      id: input.id ?? `git-${Date.now()}`,
      projectId: input.projectId,
      sessionId: input.sessionId,
      repositoryPath: input.repositoryPath ?? '',
      branchName: input.branchName ?? 'main',
      commitId: input.commitId,
      message: input.message ?? 'Repository change',
      changedFilesCount: input.changedFilesCount ?? 0,
      eventType: input.eventType ?? 'status',
      timestamp: input.timestamp ?? now,
    };

    data.gitEvents.push(newEvent);
    this.writeData(data);
    return newEvent;
  }

  getGitEventsByProject(projectId: string): GitEvent[] {
    return this.getGitEvents().filter((event) => event.projectId === projectId);
  }

  getDebriefSummary(projectId?: string): DebriefSummary {
    const projects = projectId ? this.getProjects().filter((item) => item.id === projectId) : this.getProjects();
    const tasks = projectId ? this.getTasks().filter((item) => item.projectId === projectId) : this.getTasks();
    const sessions = projectId ? this.getSessions().filter((item) => item.projectId === projectId) : this.getSessions();
    const gitEvents = projectId ? this.getGitEvents().filter((item) => item.projectId === projectId) : this.getGitEvents();

    const completedTaskCount = tasks.filter((task) => task.status === 'done').length;
    const totalSessionMinutes = Math.round(
      sessions.reduce((sum, session) => sum + this.getElapsedMilliseconds(session), 0) / (60 * 1000),
    );

    const latestBranchName = [...gitEvents]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .find((event) => event.branchName)?.branchName;

    const projectLabel = projects.length === 1
      ? projects[0].name
      : projects.length === 0
        ? 'No active project'
        : `${projects.length} projects`;

    const summary = [
      projectLabel,
      `${tasks.length} task(s) in scope`,
      `${totalSessionMinutes} minute(s) focused`,
      `${gitEvents.length} Git update(s) recorded`,
    ].join(' · ');

    return {
      projectCount: projects.length,
      taskCount: tasks.length,
      completedTaskCount,
      totalSessionMinutes,
      gitEventCount: gitEvents.length,
      latestBranchName,
      summary,
    };
  }
}
