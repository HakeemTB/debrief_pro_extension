import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { parseCliArguments, runCli } from '../../cli';
import { resolveStorageDirectory } from '../../storage/storage';

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function createHarness(): { root: string; invoke: (args: string[]) => CliResult; dispose: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'debriefpro-cli-'));
  const dataDirectory = path.join(root, 'shared-data');
  const invoke = (args: string[]): CliResult => {
    let stdout = '';
    let stderr = '';
    const code = runCli(args, {
      cwd: root,
      environment: { DEBRIEFPRO_DATA_DIR: dataDirectory },
      stdout: { write: (value: string) => { stdout += value; return true; } },
      stderr: { write: (value: string) => { stderr += value; return true; } },
    });
    return { code, stdout, stderr };
  };
  return {
    root,
    invoke,
    dispose: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

suite('DebriefPro CLI', () => {
  test('parses nested commands, quoted arguments, and help flags', () => {
    assert.deepStrictEqual(parseCliArguments(['project', 'add', 'SparkPrep']), {
      command: 'project', subcommand: 'add', args: ['SparkPrep'], help: false,
    });
    assert.deepStrictEqual(parseCliArguments(['task', 'add', 'Set up Django backend']), {
      command: 'task', subcommand: 'add', args: ['Set up Django backend'], help: false,
    });
    assert.strictEqual(parseCliArguments(['session', 'start', '--help']).help, true);
  });

  test('creates projects and persists project selection between invocations', () => {
    const cli = createHarness();
    try {
      assert.strictEqual(cli.invoke(['project', 'add', 'SparkPrep']).code, 0);
      cli.invoke(['project', 'add', 'Second Project']);
      assert.strictEqual(cli.invoke(['project', 'use', 'SparkPrep']).stdout, 'Current project: SparkPrep\n');
      const list = cli.invoke(['project', 'list']);
      assert.ok(list.stdout.includes('* SparkPrep'));
      assert.ok(list.stdout.includes('Second Project'));
      assert.strictEqual(cli.invoke(['task', 'add', 'Scoped task']).code, 0);
      assert.ok(cli.invoke(['task', 'list']).stdout.includes('Scoped task'));
    } finally {
      cli.dispose();
    }
  });

  test('supports task start and complete with ID validation', () => {
    const cli = createHarness();
    try {
      cli.invoke(['project', 'add', 'SparkPrep']);
      const created = cli.invoke(['task', 'add', 'Set up Django backend']);
      const taskId = created.stdout.match(/\[(task-[^\]]+)\]/)?.[1];
      assert.ok(taskId, 'Task creation should return a usable ID.');
      assert.ok(cli.invoke(['task', 'start', taskId!]).stdout.includes('Task started'));
      assert.ok(cli.invoke(['task', 'list']).stdout.includes('In Progress'));
      assert.ok(cli.invoke(['task', 'complete', taskId!]).stdout.includes('Task completed'));
      assert.strictEqual(cli.invoke(['task', 'start', 'missing-task']).code, 1);
      assert.strictEqual(cli.invoke(['task', 'complete']).code, 1);
    } finally {
      cli.dispose();
    }
  });

  test('starts and stops sessions and preserves state across CLI invocations', () => {
    const cli = createHarness();
    try {
      cli.invoke(['project', 'add', 'SparkPrep']);
      const started = cli.invoke(['session', 'start']);
      assert.strictEqual(started.code, 0);
      assert.ok(cli.invoke(['status']).stdout.includes('Session: active'));
      assert.strictEqual(cli.invoke(['session', 'start']).code, 1);
      assert.strictEqual(cli.invoke(['session', 'stop']).code, 0);
      assert.ok(cli.invoke(['status']).stdout.includes('Session: None'));
    } finally {
      cli.dispose();
    }
  });

  test('persists data across separate Node CLI processes', () => {
    const cli = createHarness();
    try {
      const executable = path.resolve(__dirname, '../../cli.js');
      const environment = { ...process.env, DEBRIEFPRO_DATA_DIR: path.join(cli.root, 'process-data') };
      const add = spawnSync(process.execPath, [executable, 'project', 'add', 'Process Project'], {
        cwd: cli.root,
        env: environment,
        encoding: 'utf8',
      });
      assert.strictEqual(add.status, 0, add.stderr);

      const list = spawnSync(process.execPath, [executable, 'project', 'list'], {
        cwd: cli.root,
        env: environment,
        encoding: 'utf8',
      });
      assert.strictEqual(list.status, 0, list.stderr);
      assert.ok(list.stdout.includes('Process Project'));
    } finally {
      cli.dispose();
    }
  });

  test('renders the existing debrief report and useful empty-state output', () => {
    const cli = createHarness();
    try {
      const empty = cli.invoke(['status']);
      assert.ok(empty.stdout.includes('Project: None selected'));
      cli.invoke(['project', 'add', 'SparkPrep']);
      cli.invoke(['task', 'add', 'Set up Django backend']);
      const report = cli.invoke(['report']);
      assert.strictEqual(report.code, 0);
      assert.ok(report.stdout.includes('# DebriefPro'));
      assert.ok(report.stdout.includes('Set up Django backend'));
    } finally {
      cli.dispose();
    }
  });

  test('provides help and rejects invalid commands and missing project data', () => {
    const cli = createHarness();
    try {
      assert.ok(cli.invoke(['--help']).stdout.includes('Usage:'));
      assert.strictEqual(cli.invoke(['unknown']).code, 1);
      assert.strictEqual(cli.invoke(['project', 'add']).code, 1);
      assert.strictEqual(cli.invoke(['task', 'add', 'orphan task']).code, 1);
      assert.strictEqual(cli.invoke(['session', 'stop']).code, 1);
    } finally {
      cli.dispose();
    }
  });

  test('registers a Windows-compatible npm executable entry point', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as {
      bin: Record<string, string>;
    };
    const executablePath = path.resolve(__dirname, '../../../', packageJson.bin.debrief);
    assert.strictEqual(packageJson.bin.debrief, './out/cli.js');
    assert.ok(fs.existsSync(executablePath), 'The compiled executable should exist after compilation.');
    assert.ok(fs.readFileSync(executablePath, 'utf8').startsWith('#!/usr/bin/env node'));
    assert.strictEqual(
      resolveStorageDirectory(undefined, { APPDATA: 'C:\\Users\\tester\\AppData\\Roaming' }, 'win32', 'C:\\Users\\tester'),
      path.join('C:\\Users\\tester\\AppData\\Roaming', 'Code', 'User', 'globalStorage', 'debriefpro.debriefpro'),
    );
  });
});