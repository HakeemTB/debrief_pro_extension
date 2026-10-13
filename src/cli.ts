#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { generateDebriefMarkdown } from './debrief/debriefReport';
import { LocalStorage, resolveStorageDirectory } from './storage/storage';

export interface ParsedCliArguments {
  command: string;
  subcommand?: string;
  args: string[];
  help: boolean;
}

export interface CliOptions {
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
}

export function parseCliArguments(argv: string[]): ParsedCliArguments {
  const help = argv.some((argument) => argument === '--help' || argument === '-h');
  const tokens = argv.filter((argument) => argument !== '--help' && argument !== '-h');
  const command = tokens[0] ?? 'help';
  const nestedCommands = ['project', 'task', 'session'];
  const subcommand = nestedCommands.includes(command) ? tokens[1] : undefined;
  return {
    command,
    subcommand,
    args: tokens.slice(subcommand ? 2 : 1),
    help,
  };
}

const HELP = `DebriefPro CLI

Usage:
  debrief help
  debrief init
  debrief project list
  debrief project add <name>
  debrief project use <name-or-id>
  debrief task add <title>
  debrief task list
  debrief task start <task-id>
  debrief task complete <task-id>
  debrief session start [task-id]
  debrief session stop
  debrief status
  debrief report

Options:
  -h, --help  Show help

Set DEBRIEFPRO_DATA_DIR to share a custom data directory between the CLI and VS Code extension.
`;

function writeLine(stream: Pick<NodeJS.WriteStream, 'write'>, value = ''): void {
  stream.write(`${value}\n`);
}

function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function findTask(storage: LocalStorage, taskId: string) {
  return storage.getTasks().find((task) => task.id === taskId);
}

function resolveTaskStatus(status: string): string {
  return status.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function runGitStatus(cwd: string): { branch: string; changedFiles: number } | undefined {
  try {
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const status = execFileSync('git', ['status', '--short'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { branch: branch || 'detached HEAD', changedFiles: status ? status.split(/\r?\n/).length : 0 };
  } catch {
    return undefined;
  }
}

function commandHelp(command: string, subcommand?: string): string {
  if (command === 'project') {
    return 'Usage: debrief project list | add <name> | use <name-or-id>\n';
  }
  if (command === 'task') {
    return 'Usage: debrief task list | add <title> | start <task-id> | complete <task-id>\n';
  }
  if (command === 'session') {
    return 'Usage: debrief session start [task-id] | stop\n';
  }
  return subcommand ? HELP : HELP;
}

export function runCli(argv: string[], options: CliOptions = {}): number {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const cwd = options.cwd ?? process.cwd();
  const environment = options.environment ?? process.env;
  const parsed = parseCliArguments(argv);

  if (parsed.help || parsed.command === 'help') {
    writeLine(stdout, parsed.command === 'help' && parsed.subcommand ? commandHelp(parsed.command, parsed.subcommand) : HELP);
    return 0;
  }

  const storagePath = resolveStorageDirectory(undefined, environment, options.platform, options.homeDirectory);
  const storage = new LocalStorage(storagePath);

  try {
    if (parsed.command === 'init') {
      if (parsed.args.length > 0) {
        throw new Error('Usage: debrief init');
      }
      storage.ensureReady();
      writeLine(stdout, `DebriefPro initialized.\nData: ${storagePath}`);
      return 0;
    }

    if (parsed.command === 'project') {
      if (parsed.subcommand === 'list' && parsed.args.length === 0) {
        const projects = storage.getProjects();
        if (projects.length === 0) {
          writeLine(stdout, 'No projects yet. Create one with: debrief project add "Project name"');
          return 0;
        }
        const activeProject = storage.getActiveProject();
        for (const project of projects) {
          writeLine(stdout, `${project.id === activeProject?.id ? '* ' : '  '}${project.name} (${project.status}) [${project.id}]`);
        }
        return 0;
      }

      if (parsed.subcommand === 'add' && parsed.args.length > 0) {
        const name = parsed.args.join(' ').trim();
        if (!name) {
          throw new Error('Project name cannot be empty.');
        }
        if (storage.getProjects().some((project) => project.name.toLowerCase() === name.toLowerCase())) {
          throw new Error(`A project named "${name}" already exists.`);
        }
        const project = storage.createProject({ name });
        if (!storage.getActiveProject()) {
          storage.setActiveProject(project.id);
        }
        writeLine(stdout, `Project added: ${project.name} [${project.id}]`);
        return 0;
      }

      if (parsed.subcommand === 'use' && parsed.args.length > 0) {
        const requested = parsed.args.join(' ').trim();
        const matches = storage.getProjects().filter((project) => project.id === requested || project.name === requested);
        if (matches.length === 0) {
          throw new Error(`No project found named or identified by "${requested}".`);
        }
        if (matches.length > 1) {
          throw new Error(`More than one project is named "${requested}". Select one by ID.`);
        }
        const project = storage.setActiveProject(matches[0].id);
        writeLine(stdout, `Current project: ${project!.name}`);
        return 0;
      }

      throw new Error(commandHelp('project').trim());
    }

    if (parsed.command === 'task') {
      if (parsed.subcommand === 'list' && parsed.args.length === 0) {
        const activeProject = storage.getActiveProject();
        const tasks = storage.getTasks().filter((task) => !activeProject || task.projectId === activeProject.id);
        if (tasks.length === 0) {
          writeLine(stdout, activeProject ? `No tasks for ${activeProject.name}. Add one with: debrief task add "Task title"` : 'No tasks yet. Add a project first with: debrief project add "Project name"');
          return 0;
        }
        for (const task of tasks) {
          writeLine(stdout, `${task.id}  ${resolveTaskStatus(task.status).padEnd(12)} ${task.title}`);
        }
        return 0;
      }

      if (parsed.subcommand === 'add' && parsed.args.length > 0) {
        const project = storage.getActiveProject();
        if (!project) {
          throw new Error('Select or create a project first: debrief project add "Project name"');
        }
        const title = parsed.args.join(' ').trim();
        if (!title) {
          throw new Error('Task title cannot be empty.');
        }
        const task = storage.createTask(project.id, { title, status: 'todo', priority: 'medium', estimateHours: 1 });
        writeLine(stdout, `Task added: ${task.title} [${task.id}]`);
        return 0;
      }

      if ((parsed.subcommand === 'start' || parsed.subcommand === 'complete') && parsed.args.length === 1) {
        const task = findTask(storage, parsed.args[0]);
        if (!task) {
          throw new Error(`No task found with ID "${parsed.args[0]}". Run: debrief task list`);
        }
        const status = parsed.subcommand === 'start' ? 'in-progress' : 'done';
        if (task.status === 'done' && status === 'in-progress') {
          throw new Error(`Task "${task.title}" is already complete.`);
        }
        storage.updateTask(task.id, { status });
        writeLine(stdout, `Task ${parsed.subcommand === 'start' ? 'started' : 'completed'}: ${task.title}`);
        return 0;
      }

      throw new Error(commandHelp('task').trim());
    }

    if (parsed.command === 'session') {
      if (parsed.subcommand === 'start' && parsed.args.length <= 1) {
        const project = storage.getActiveProject();
        if (!project) {
          throw new Error('Select or create a project first: debrief project add "Project name"');
        }
        const existing = storage.getActiveSession();
        if (existing) {
          throw new Error(`A session is already ${existing.state}. Stop it before starting another.`);
        }
        const taskId = parsed.args[0];
        if (taskId) {
          const task = findTask(storage, taskId);
          if (!task || task.projectId !== project.id) {
            throw new Error(`Task ID "${taskId}" is not a task in the current project.`);
          }
        }
        const session = storage.createSession(project.id, taskId);
        writeLine(stdout, `Session started: ${project.name}${taskId ? ` · ${findTask(storage, taskId)?.title}` : ''}`);
        writeLine(stdout, `Session ID: ${session.id}`);
        return 0;
      }

      if (parsed.subcommand === 'stop' && parsed.args.length === 0) {
        const session = storage.getActiveSession();
        if (!session) {
          throw new Error('There is no active session to stop.');
        }
        storage.addSessionEvent(session.id, 'ended');
        writeLine(stdout, `Session stopped: ${session.id}`);
        return 0;
      }

      throw new Error(commandHelp('session').trim());
    }

    if (parsed.command === 'status' && parsed.args.length === 0) {
      const project = storage.getActiveProject();
      const tasks = project ? storage.getTasksByProject(project.id) : storage.getTasks();
      const completedTasks = tasks.filter((task) => task.status === 'done').length;
      const currentTask = tasks.find((task) => task.status === 'in-progress');
      const session = storage.getActiveSession();
      const gitStatus = runGitStatus(cwd);
      const summary = storage.getDebriefSummary(project?.id);

      writeLine(stdout, 'DebriefPro');
      writeLine(stdout, `Project: ${project?.name ?? 'None selected'}`);
      writeLine(stdout, `Tasks: ${completedTasks}/${tasks.length} complete`);
      writeLine(stdout, `Task: ${currentTask ? `${currentTask.title} (${resolveTaskStatus(currentTask.status)})` : 'No task in progress'}`);
      writeLine(stdout, `Session: ${session ? `${session.state} · ${duration(storage.getElapsedMilliseconds(session))}` : 'None'}`);
      writeLine(stdout, `Git: ${summary.gitEventCount} tracked update(s)${summary.latestBranchName ? ` · latest branch ${summary.latestBranchName}` : ''}`);
      writeLine(stdout, gitStatus
        ? `Working tree: ${gitStatus.branch} · ${gitStatus.changedFiles} changed file(s)`
        : 'Working tree: Git status unavailable in this directory');
      return 0;
    }

    if (parsed.command === 'report' && parsed.args.length === 0) {
      const project = storage.getActiveProject();
      const session = storage.getActiveSession();
      writeLine(stdout, generateDebriefMarkdown(storage, {
        projectId: project?.id,
        sessionId: session?.id,
        workspacePath: cwd,
      }));
      return 0;
    }

    throw new Error(`Unknown command "${parsed.command}". Run: debrief help`);
  } catch (error) {
    writeLine(stderr, `Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = runCli(process.argv.slice(2));
}