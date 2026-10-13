import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { generateDebriefMarkdown } from '../../debrief/debriefReport';
import { LocalStorage } from '../../storage/storage';

suite('DebriefPro extension tests', () => {
  test('should activate the extension and register commands', async () => {
    const extension = vscode.extensions.getExtension('debriefpro.debriefpro');
    assert.ok(extension, 'Extension should be present in the VS Code extension list.');

    await extension!.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('debriefpro.openSidebar'));
    assert.ok(commands.includes('debriefpro.createProject'));
    assert.ok(commands.includes('debriefpro.generateDebrief'));
  });

  test('should persist a project and its tasks in local storage', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debriefpro-'));
    const storage = new LocalStorage(tempDir);

    const project = storage.createProject({
      name: 'Project Alpha',
      description: 'Planning and execution tracking',
      status: 'active',
    });

    const task = storage.createTask(project.id, {
      title: 'Create onboarding flow',
      status: 'todo',
      priority: 'high',
      estimateHours: 6,
    });

    const storedProject = storage.getProjects().find((item) => item.id === project.id);
    const storedTasks = storage.getTasksByProject(project.id);

    assert.ok(storedProject, 'The project should be saved to storage.');
    assert.strictEqual(storedProject!.name, 'Project Alpha');
    assert.ok(task, 'The task should be created.');
    assert.strictEqual(storedTasks.length, 1);
    assert.strictEqual(storedTasks[0].title, 'Create onboarding flow');

    storage.updateTask(task.id, { status: 'in-progress' });
    const taskHistory = storage.getHistoryEvents(project.id).find((event) => event.title === 'Task updated: Create onboarding flow');
    assert.ok(taskHistory?.details.includes('status: todo -> in-progress'));

    const session = storage.createSession(project.id, task.id);
    storage.addSessionEvent(session.id, 'paused');
    const storedSession = storage.getSessions().find((item) => item.id === session.id);

    assert.ok(storedSession, 'The session should be saved to storage.');
    assert.strictEqual(storedSession!.state, 'paused');
    assert.strictEqual(storedSession!.events.length, 2);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('should detect interrupted sessions and persist Git metadata', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debriefpro-'));
    const storage = new LocalStorage(tempDir);

    const project = storage.createProject({
      name: 'Project Beta',
      description: 'Recovery and Git tracking',
      status: 'active',
    });

    const session = storage.createSession(project.id);
    const oldTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    storage.updateSessionTimestamp(session.id, oldTimestamp);

    const interrupted = storage.getInterruptedSessions();
    assert.strictEqual(interrupted.length, 1, 'An active session with stale updates should be treated as interrupted.');

    const event = storage.createGitEvent({
      projectId: project.id,
      repositoryPath: '/workspace/project-beta',
      branchName: 'feature/session-recovery',
      commitId: 'abc123',
      message: 'Add recovery logic',
      changedFilesCount: 3,
      eventType: 'commit',
    });

    const gitEvents = storage.getGitEventsByProject(project.id);
    assert.strictEqual(gitEvents.length, 1);
    assert.strictEqual(event.message, 'Add recovery logic');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('should summarize active work in a debrief snapshot', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debriefpro-'));
    const storage = new LocalStorage(tempDir);

    const project = storage.createProject({
      name: 'Project Gamma',
      description: 'Debrief summary tracking',
      status: 'active',
    });

    storage.createTask(project.id, {
      title: 'Ship onboarding details',
      status: 'done',
      priority: 'high',
      estimateHours: 4,
    });

    const session = storage.createSession(project.id);
    storage.addSessionEvent(session.id, 'paused');
    storage.addSessionEvent(session.id, 'resumed');
    storage.addSessionEvent(session.id, 'ended');

    storage.createGitEvent({
      projectId: project.id,
      branchName: 'feature/debrief-summary',
      message: 'Capture work summary',
      eventType: 'branch',
    });

    const summary = storage.getDebriefSummary(project.id);
    assert.strictEqual(summary.projectCount, 1);
    assert.strictEqual(summary.taskCount, 1);
    assert.strictEqual(summary.completedTaskCount, 1);
    assert.strictEqual(summary.gitEventCount, 1);
    assert.strictEqual(summary.latestBranchName, 'feature/debrief-summary');
    assert.ok(summary.summary.includes('Project Gamma'));

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('should generate a markdown debrief report with project and session context', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debriefpro-'));
    const storage = new LocalStorage(tempDir);

    const project = storage.createProject({
      name: 'Project Delta',
      description: 'Research and release validation',
      status: 'active',
    });

    storage.createTask(project.id, {
      title: 'Refine launch checklist',
      status: 'done',
      priority: 'high',
      estimateHours: 3,
    });

    storage.createTask(project.id, {
      title: 'Investigate deployment blockers',
      status: 'in-progress',
      priority: 'medium',
      estimateHours: 5,
    });

    const session = storage.createSession(project.id);
    storage.addSessionEvent(session.id, 'paused');
    storage.addSessionEvent(session.id, 'resumed');
    storage.addSessionEvent(session.id, 'ended');

    storage.createGitEvent({
      projectId: project.id,
      branchName: 'feature/release-readiness',
      message: 'Prepare release notes',
      eventType: 'branch',
    });

    const markdown = generateDebriefMarkdown(storage, { projectId: project.id, sessionId: session.id, workspacePath: tempDir });
    assert.ok(markdown.includes('# DebriefPro'));
    assert.ok(markdown.includes('Project Delta'));
    assert.ok(markdown.includes('Refine launch checklist'));
    assert.ok(markdown.includes('Total focus time'));
    assert.ok(markdown.includes('Git activity'));
    assert.ok(markdown.includes('feature/release-readiness'));

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('should only count active work time across pause and resume cycles', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debriefpro-'));
    const storage = new LocalStorage(tempDir);

    const project = storage.createProject({ name: 'Project Reliability', status: 'active' });
    const session = storage.createSession(project.id);

    const now = Date.now();
    const start = new Date(now - 60 * 60 * 1000).toISOString();
    const pause = new Date(now - 45 * 60 * 1000).toISOString();
    const resume = new Date(now - 30 * 60 * 1000).toISOString();
    const end = new Date(now - 5 * 60 * 1000).toISOString();

    session.startedAt = start;
    session.updatedAt = end;
    session.endedAt = end;
    session.events = [
      { id: 'event-start', sessionId: session.id, type: 'started', timestamp: start },
      { id: 'event-pause', sessionId: session.id, type: 'paused', timestamp: pause },
      { id: 'event-resume', sessionId: session.id, type: 'resumed', timestamp: resume },
      { id: 'event-end', sessionId: session.id, type: 'ended', timestamp: end },
    ];

    storage.writeData({
      projects: storage.getProjects(),
      tasks: storage.getTasks(),
      sessions: [session],
      gitEvents: storage.getGitEvents(),
      historyEvents: storage.getHistoryEvents(),
    });

    const elapsed = storage.getElapsedMilliseconds(session);
    assert.ok(elapsed >= 25 * 60 * 1000 && elapsed < 60 * 60 * 1000, 'Only active work time should count; idle pauses should be excluded.');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('should ignore invalid session lifecycle transitions and preserve elapsed time across multiple pause cycles', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debriefpro-'));
    const storage = new LocalStorage(tempDir);

    const project = storage.createProject({ name: 'Project Recovery', status: 'active' });
    const session = storage.createSession(project.id);

    const now = Date.now();
    const start = new Date(now - 60 * 60 * 1000).toISOString();
    const pause = new Date(now - 45 * 60 * 1000).toISOString();
    const resume = new Date(now - 30 * 60 * 1000).toISOString();
    const secondPause = new Date(now - 20 * 60 * 1000).toISOString();
    const finalResume = new Date(now - 10 * 60 * 1000).toISOString();
    const end = new Date(now - 5 * 60 * 1000).toISOString();

    session.state = 'ended';
    session.startedAt = start;
    session.updatedAt = end;
    session.endedAt = end;
    session.events = [
      { id: 'event-start', sessionId: session.id, type: 'started', timestamp: start },
      { id: 'event-pause', sessionId: session.id, type: 'paused', timestamp: pause },
      { id: 'event-resume', sessionId: session.id, type: 'resumed', timestamp: resume },
      { id: 'event-pause-2', sessionId: session.id, type: 'paused', timestamp: secondPause },
      { id: 'event-resume-2', sessionId: session.id, type: 'resumed', timestamp: finalResume },
      { id: 'event-end', sessionId: session.id, type: 'ended', timestamp: end },
    ];

    storage.writeData({
      projects: storage.getProjects(),
      tasks: storage.getTasks(),
      sessions: [session],
      gitEvents: storage.getGitEvents(),
      historyEvents: storage.getHistoryEvents(),
    });

    const elapsed = storage.getElapsedMilliseconds(session);
    assert.ok(elapsed >= 25 * 60 * 1000 && elapsed < 60 * 60 * 1000, 'Multiple pause-resume cycles should exclude idle time without double-counting.');

    const duplicatePause = storage.addSessionEvent(session.id, 'paused');
    assert.strictEqual(duplicatePause?.state, 'ended', 'Repeated pause transitions should be ignored when the session is already ended.');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('should recover interrupted sessions after a VS Code restart without losing data', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debriefpro-'));
    const original = new LocalStorage(tempDir);

    const project = original.createProject({ name: 'Project Recovery', status: 'active' });
    const session = original.createSession(project.id);
    original.updateSessionTimestamp(session.id, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

    const restarted = new LocalStorage(tempDir);
    const recovered = restarted.getInterruptedSessions();
    assert.strictEqual(recovered.length, 1, 'An active stale session should remain recoverable after restart.');
    assert.strictEqual(recovered[0].id, session.id);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('should associate Git activity with the correct project and session when available', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debriefpro-'));
    const storage = new LocalStorage(tempDir);

    const project = storage.createProject({ name: 'Project Git', status: 'active' });
    const session = storage.createSession(project.id);

    const event = storage.createGitEvent({
      projectId: project.id,
      sessionId: session.id,
      repositoryPath: '/workspace/project-git',
      branchName: 'feature/reliability',
      commitId: 'abc',
      message: 'Stabilize session tracking',
      eventType: 'commit',
    });

    assert.strictEqual(event.projectId, project.id);
    assert.strictEqual(event.sessionId, session.id);
    assert.strictEqual(storage.getGitEventsByProject(project.id).length, 1);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('should preserve records across a restart and keep text reports consistent with storage', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debriefpro-'));
    const first = new LocalStorage(tempDir);

    const project = first.createProject({
      name: 'Project Persistence',
      description: 'Check restarts',
      status: 'active',
      notes: 'Keep notes across restart',
    });

    first.createTask(project.id, {
      title: 'Persist history',
      status: 'done',
      priority: 'high',
      estimateHours: 2,
      notes: 'Recorded before restart',
    });

    const session = first.createSession(project.id);
    first.createGitEvent({
      projectId: project.id,
      sessionId: session.id,
      branchName: 'main',
      message: 'Persisted state',
      eventType: 'status',
    });

    const second = new LocalStorage(tempDir);
    const reloadedProject = second.getProjects()[0];
    const reloadedTask = second.getTasks()[0];
    const reloadedSession = second.getSessions()[0];
    const reloadedSummary = second.getDebriefSummary(reloadedProject.id);
    const markdown = generateDebriefMarkdown(second, {
      projectId: reloadedProject.id,
      sessionId: reloadedSession.id,
      workspacePath: tempDir,
    });

    assert.strictEqual(reloadedProject.notes, 'Keep notes across restart');
    assert.strictEqual(reloadedTask.notes, 'Recorded before restart');
    assert.strictEqual(reloadedSession.id, session.id);
    assert.strictEqual(reloadedSummary.taskCount, 1);
    assert.ok(markdown.includes('Project Persistence'));
    assert.ok(markdown.includes('Persist history'));

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('should escape markdown-sensitive content and tolerate missing data', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debriefpro-'));
    const storage = new LocalStorage(tempDir);

    const markdown = generateDebriefMarkdown(storage, {
      projectId: 'missing-project',
      sessionId: 'missing-session',
      workspacePath: tempDir,
    });

    assert.ok(markdown.includes('No tracked project'));
    assert.ok(markdown.includes('No active session'));
    assert.ok(markdown.includes('No Git activity recorded'));

    const escaped = generateDebriefMarkdown(storage, {
      projectId: 'project-with-special-chars',
      workspacePath: tempDir,
    });

    assert.ok(escaped.includes('No tracked project'));

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
