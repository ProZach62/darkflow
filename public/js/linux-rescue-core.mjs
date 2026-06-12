const DEFAULT_CWD = '/home/jason/project';
const DIRECTORIES = new Set([
  '/home/jason',
  '/home/jason/project',
  '/home/jason/project/src',
  '/home/jason/project/logs',
  '/var/log',
  '/tmp',
]);

const DIRECTORY_LISTINGS = {
  '/home/jason': ['project/', 'notes.txt', 'todo.md'],
  '/home/jason/project': ['Makefile', 'README.md', 'src/', 'logs/', 'deploy.sh', 'package.json'],
  '/home/jason/project/src': ['main.c', 'config.h', 'worker.c', 'terminal.c'],
  '/home/jason/project/logs': ['build.log', 'access.log', 'errors.log'],
  '/var/log': ['auth.log', 'syslog', 'kern.log'],
  '/tmp': ['session.lock', 'build-cache/'],
};

const FILE_CONTENTS = {
  '/home/jason/notes.txt': [
    'Review staging logs',
    'Confirm backup rotation',
    'Follow up on deployment window',
  ],
  '/home/jason/todo.md': [
    '- check service health',
    '- verify cron output',
    '- update incident notes',
  ],
  '/home/jason/project/README.md': [
    '# Operations Console',
    '',
    'Internal maintenance workspace.',
  ],
  '/home/jason/project/package.json': [
    '{',
    '  "scripts": {',
    '    "test": "node --test",',
    '    "start": "node server.js"',
    '  }',
    '}',
  ],
  '/home/jason/project/logs/build.log': [
    '[ok] compile completed',
    '[ok] tests completed',
    '[ok] artifact staged',
  ],
};

export function createLinuxRescueState(overrides = {}) {
  return {
    cwd: overrides.cwd || DEFAULT_CWD,
    user: overrides.user || 'jason',
    host: overrides.host || 'workstation',
    history: Array.isArray(overrides.history) ? overrides.history.slice() : [],
  };
}

function normalizePath(cwd, input) {
  const raw = String(input || '').trim();
  if (!raw || raw === '~') return '/home/jason';
  if (raw === '-') return DEFAULT_CWD;
  if (raw.startsWith('~/')) return normalizePath('/home/jason', raw.slice(2));
  if (raw.startsWith('/')) return raw.replace(/\/+$/g, '') || '/';

  const parts = (cwd + '/' + raw).split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return '/' + out.join('/');
}

function displayPath(path) {
  if (path === '/home/jason') return '~';
  if (path.startsWith('/home/jason/')) return '~/' + path.slice('/home/jason/'.length);
  return path;
}

export function getLinuxRescuePrompt(state) {
  const work = state || createLinuxRescueState();
  return work.user + '@' + work.host + ':' + displayPath(work.cwd) + '$';
}

function fakeTop() {
  return [
    'top - 09:42:17 up 18 days,  4:21,  2 users,  load average: 0.16, 0.19, 0.17',
    'Tasks: 143 total,   1 running, 142 sleeping,   0 stopped,   0 zombie',
    '%Cpu(s):  2.1 us,  0.8 sy,  0.0 ni, 96.8 id,  0.3 wa',
    'MiB Mem :  32768.0 total,  19420.4 free,   6641.1 used,   6706.5 buff/cache',
    '',
    '  PID USER      PR  NI    VIRT    RES  %CPU  %MEM COMMAND',
    ' 1842 jason     20   0  812.1m  94.8m   1.4   0.3 node',
    '  918 root      20   0  326.0m  42.3m   0.6   0.1 sshd',
  ];
}

function readFile(state, target) {
  const path = normalizePath(state.cwd, target);
  return FILE_CONTENTS[path] || ['cat: ' + target + ': No such file or directory'];
}

export function runLinuxRescueCommand(state, rawCommand) {
  const work = state || createLinuxRescueState();
  const raw = String(rawCommand || '').trim();
  if (!raw) return { output: [] };

  work.history.push(raw);
  const parts = raw.split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);

  switch (command) {
  case 'exit':
  case 'logout':
    return { exit: true, output: ['logout'] };
  case 'clear':
    return { clear: true, output: [] };
  case 'help':
    return { output: [
      'Available commands: help, clear, pwd, ls, cd, cat, grep, tail, ps, top,',
      'git status, make, npm test, date, whoami, hostname, uname, history, exit',
    ] };
  case 'pwd':
    return { output: [work.cwd] };
  case 'ls': {
    const dir = normalizePath(work.cwd, args[0] || '.');
    return { output: DIRECTORY_LISTINGS[dir] || ['ls: cannot access ' + (args[0] || '.') + ': No such file or directory'] };
  }
  case 'cd': {
    const next = normalizePath(work.cwd, args[0] || '~');
    if (!DIRECTORIES.has(next)) return { output: ['cd: ' + (args[0] || '~') + ': No such file or directory'] };
    work.cwd = next;
    return { output: [] };
  }
  case 'cat':
    return { output: args[0] ? readFile(work, args[0]) : ['cat: missing file operand'] };
  case 'tail':
    return { output: args.length ? readFile(work, args[args.length - 1]).slice(-10) : ['tail: missing file operand'] };
  case 'grep':
    return { output: ['grep: scanned 18 files, 0 errors, 3 matches queued for review'] };
  case 'ps':
    return { output: [
      '  PID TTY          TIME CMD',
      ' 1042 pts/0    00:00:00 bash',
      ' 1842 pts/0    00:00:01 node',
      ' 1911 pts/0    00:00:00 ps',
    ] };
  case 'top':
    return { output: fakeTop() };
  case 'git':
    if (args[0] === 'status') {
      return { output: [
        'On branch main',
        'Your branch is up to date with origin/main.',
        '',
        'nothing to commit, working tree clean',
      ] };
    }
    return { output: ['git: simulated workspace accepts only "git status"'] };
  case 'make':
    return { output: ['cc -O2 -Wall -c src/main.c', 'cc -O2 -Wall -o build/service src/main.o', 'Build complete.'] };
  case 'npm':
    if (args[0] === 'test') return { output: ['> node --test', 'ok 12 tests passed', 'duration_ms 842'] };
    return { output: ['npm: simulated workspace accepts only "npm test"'] };
  case 'date':
    return { output: [new Date().toString()] };
  case 'whoami':
    return { output: [work.user] };
  case 'hostname':
    return { output: [work.host] };
  case 'uname':
    return { output: ['Linux workstation 6.8.0-generic x86_64 GNU/Linux'] };
  case 'history':
    return { output: work.history.map((item, index) => String(index + 1).padStart(4, ' ') + '  ' + item) };
  default:
    return { output: [command + ': command not found'] };
  }
}
