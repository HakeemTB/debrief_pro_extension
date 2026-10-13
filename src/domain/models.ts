export type ProjectStatus = 'planned' | 'active' | 'paused' | 'completed' | 'archived';

export interface Project {
  id: string;
  name: string;
  description: string;
  objective?: string;
  notes?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  status: 'backlog' | 'todo' | 'in-progress' | 'blocked' | 'review' | 'done';
  priority: 'low' | 'medium' | 'high';
  estimateHours?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type SessionState = 'idle' | 'active' | 'paused' | 'ended';

export interface SessionEvent {
  id: string;
  sessionId: string;
  type: 'started' | 'paused' | 'resumed' | 'ended';
  timestamp: string;
}

export interface WorkSession {
  id: string;
  projectId: string;
  taskId?: string;
  notes?: string;
  state: SessionState;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  events: SessionEvent[];
}

export type GitEventType = 'commit' | 'branch' | 'repository' | 'status';

export interface GitEvent {
  id: string;
  projectId?: string;
  sessionId?: string;
  repositoryPath?: string;
  branchName?: string;
  commitId?: string;
  message?: string;
  changedFilesCount?: number;
  eventType: GitEventType;
  timestamp: string;
  changedFiles?: string[];
}

export interface HistoryEvent {
  id: string;
  source: 'app' | 'git';
  title: string;
  details: string;
  timestamp: string;
  projectId?: string;
  sessionId?: string;
  repositoryPath?: string;
  commitId?: string;
  changedFiles?: string[];
}
