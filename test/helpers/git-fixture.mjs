import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { devNull } from 'node:os';
// Applies only to disposable test repositories; never changes host Git configuration.
export function fixtureExec(command, args, options = {}) {
  if (command !== 'git') return execFileSync(command, args, options);
  const env = { ...process.env, ...options.env };
  for (const key of Object.keys(env))
    if (
      /^GIT_(CONFIG.*|DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES)$/.test(
        key,
      )
    )
      delete env[key];
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'])
    if (!Object.hasOwn(options.env ?? {}, key)) delete env[key];
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
  });
  const output = execFileSync(
    command,
    ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + devNull, '-c', 'core.autocrlf=false', ...args],
    { ...options, env },
  );
  if (args.includes('init')) {
    const root = args[0] === '-C' ? args[1] : options.cwd;
    if (!root) throw new Error('Fixture root required');
    execFileSync(command, ['config', 'user.name', 'Fixture'], { cwd: root, env });
    execFileSync(command, ['config', 'user.email', 'fixture@example.invalid'], { cwd: root, env });
    writeFileSync(join(root, '.gitattributes'), '* text=auto eol=lf\n');
    execFileSync(command, ['-c', 'core.hooksPath=' + devNull, 'add', '.gitattributes'], { cwd: root, env });
  }
  return output;
}
