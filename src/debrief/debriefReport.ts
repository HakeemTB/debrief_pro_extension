import { GitEvent, Project, Task, WorkSession } from '../domain/models';
import { LocalStorage } from '../storage/storage';

export interface DebriefReportOptions {
  projectId?: string;
  sessionId?: string;
  workspacePath?: string;
  generatedAt?: Date;
}

export function escapeMarkdown(value: string | null | undefined): string {
  if (value === undefined || value === null || value === '') {
    return 'N/A';
  }

  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\n/g, ' ');
}

export function generateDebriefMarkdown(storage: LocalStorage, options: DebriefReportOptions = {}): string {
  const generatedAt = options.generatedAt ?? new Date();
  const allProjects = storage.getProjects();
  const allTasks = storage.getTasks();
  const allSessions = storage.getSessions();
  const allGitEvents = storage.getGitEvents();

  const selectedProject = options.projectId
    ? allProjects.find((project) => project.id === options.projectId)
    : undefined;

  const scopeProjects = selectedProject ? [selectedProject] : allProjects;
  const projectTasks = selectedProject
    ? allTasks.filter((task) => task.projectId === selectedProject.id)
    : allTasks;

  const summary = storage.getDebriefSummary(selectedProject?.id);
  const latestBranch = summary.latestBranchName ?? 'No branch tracked';
  const selectedSession = options.sessionId
    ? allSessions.find((session) => session.id === options.sessionId)
    : storage.getActiveSession() ?? undefined;

  const lines: string[] = [];
  lines.push('# DebriefPro');
  lines.push('');
  lines.push(`- Generated: ${generatedAt.toISOString()}`);
  lines.push(`- Workspace: ${escapeMarkdown(options.workspacePath ?? 'No workspace folder selected')}`);
  lines.push(`- Scope: ${selectedProject ? escapeMarkdown(selectedProject.name) : scopeProjects.length > 0 ? 'Workspace overview' : 'No tracked project'}`);
  lines.push('');

  lines.push('## Workspace overview');
  if (scopeProjects.length === 0) {
    lines.push('- No tracked projects found.');
  } else {
    lines.push(`- Projects tracked: ${summary.projectCount}`);
    lines.push(`- Tasks in scope: ${summary.taskCount}`);
    lines.push(`- Completed tasks: ${summary.completedTaskCount}`);
    lines.push(`- Completion rate: ${projectTasks.length > 0 ? ((summary.completedTaskCount / projectTasks.length) * 100).toFixed(0) : '0'}%`);
  }

  lines.push('');
  lines.push('## Project context');
  if (!selectedProject) {
    lines.push('- Workspace summary only; no single project selected.');
    if (allProjects.length > 0) {
      for (const project of allProjects) {
        lines.push(`- ${escapeMarkdown(project.name)}: ${escapeMarkdown(project.description || 'No description recorded')}`);
        if (project.notes) {
          lines.push(`  - Notes: ${escapeMarkdown(project.notes)}`);
        }
      }
    }
  } else {
    lines.push(`- Project: ${escapeMarkdown(selectedProject.name)}`);
    lines.push(`- Status: ${escapeMarkdown(selectedProject.status)}`);
    lines.push(`- Objective: ${escapeMarkdown(selectedProject.objective || 'No objective recorded')}`);
    lines.push(`- Description: ${escapeMarkdown(selectedProject.description || 'No description recorded')}`);
    if (selectedProject.notes) {
      lines.push(`- Notes: ${escapeMarkdown(selectedProject.notes)}`);
    }
  }

  lines.push('');
  lines.push('## Total focus time');
  lines.push(`- The total focus time is calculated by summing each recorded session's elapsed duration and subtracting pause intervals. This uses the persisted session events to exclude pauses between resumed states.`);
  lines.push(`- Total: ${summary.totalSessionMinutes} minute(s)`);

  lines.push('');
  lines.push('## Git activity');
  const relevantGitEvents = selectedProject
    ? allGitEvents.filter((event) => event.projectId === selectedProject.id)
    : allGitEvents;

  if (relevantGitEvents.length === 0) {
    lines.push('- No Git activity recorded.');
  } else {
    lines.push(`- Git updates: ${summary.gitEventCount}`);
    lines.push(`- Latest branch: ${escapeMarkdown(latestBranch)}`);
    for (const event of relevantGitEvents.slice(0, 5)) {
      lines.push(`- ${event.timestamp}: ${escapeMarkdown(event.message || event.eventType)} (${escapeMarkdown(event.branchName || 'branch not recorded')})`);
    }
  }

  lines.push('');
  lines.push('## Session details');
  if (!selectedSession) {
    lines.push('- No active session was detected.');
  } else {
    const sessionTask = selectedSession.taskId
      ? allTasks.find((task) => task.id === selectedSession.taskId)
      : undefined;
    const sessionMinutes = Math.max(0, Math.round(storage.getElapsedMilliseconds(selectedSession) / (60 * 1000)));

    lines.push(`- Session state: ${escapeMarkdown(selectedSession.state)}`);
    lines.push(`- Started: ${escapeMarkdown(selectedSession.startedAt)}`);
    lines.push(`- Ended: ${escapeMarkdown(selectedSession.endedAt ?? 'Still running')}`);
    lines.push(`- Focus time: ${sessionMinutes} minute(s)`);
    lines.push(`- Associated task: ${escapeMarkdown(sessionTask?.title ?? 'No specific task recorded')}`);
    for (const event of selectedSession.events) {
      lines.push(`- ${escapeMarkdown(event.type)} @ ${escapeMarkdown(event.timestamp)}`);
    }
  }

  lines.push('');
  lines.push('## Tasks');
  if (projectTasks.length === 0) {
    lines.push('- No tasks recorded for the selected scope.');
  } else {
    const completed = projectTasks.filter((task) => task.status === 'done');
    const unfinished = projectTasks.filter((task) => task.status !== 'done');

    if (completed.length > 0) {
      lines.push('### Completed');
      for (const task of completed) {
        lines.push(`- ${escapeMarkdown(task.title)} (${escapeMarkdown(task.priority)} priority, estimate: ${task.estimateHours ?? 0}h)`);
      }
    } else {
      lines.push('- No completed tasks recorded.');
    }

    if (unfinished.length > 0) {
      lines.push('### Unfinished');
      for (const task of unfinished) {
        lines.push(`- ${escapeMarkdown(task.title)} (${escapeMarkdown(task.status)}, ${escapeMarkdown(task.priority)} priority, estimate: ${task.estimateHours ?? 0}h)`);
      }
    } else {
      lines.push('- All tracked tasks are complete.');
    }
  }

  lines.push('');
  lines.push('## Notes, blockers, and decisions');
  const projectNotes = selectedProject?.notes ?? '';
  const sessionNotes = selectedSession?.notes ?? '';
  const notes = [projectNotes, sessionNotes].filter((entry) => Boolean(entry && entry.trim())).map((entry) => escapeMarkdown(entry));

  if (notes.length === 0) {
    lines.push('- No structured notes, blockers, or decisions are currently stored in the extension data model.');
  } else {
    for (const note of notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join('\n');
}
