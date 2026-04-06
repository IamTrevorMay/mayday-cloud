const fs = require('fs');
const path = require('path');

let logFile = null;

function timestamp() {
  return new Date().toISOString();
}

function enableFileLog(dir) {
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, 'mayday-cloud.log');
}

function write(level, ...args) {
  const ts = timestamp();
  const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const line = `[${ts}] [${level}] ${msg}`;

  if (level === 'ERROR') {
    console.error(line);
  } else {
    console.log(line);
  }

  if (logFile) {
    fs.appendFileSync(logFile, line + '\n', 'utf8');
  }
}

module.exports = {
  enableFileLog,
  info: (...args) => write('INFO', ...args),
  warn: (...args) => write('WARN', ...args),
  error: (...args) => write('ERROR', ...args),
  debug: (...args) => {
    if (process.env.DEBUG) write('DEBUG', ...args);
  },
};
