/**
 * Leveled, color-coded terminal logger for Broker operations.
 */
const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

const LEVEL_COLOR = {
  error: ANSI.red,
  warn: ANSI.yellow,
  info: ANSI.cyan,
  debug: ANSI.gray,
};

function useColor() {
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== '') return false;
  if (process.env.FORCE_COLOR === '0') return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout && process.stdout.isTTY);
}

function paint(enabled, color, text) {
  if (!enabled || !color) return String(text);
  return `${color}${text}${ANSI.reset}`;
}

function clock() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function createLogger(scope, level = process.env.LOG_LEVEL || 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const colored = useColor();

  const emit = (lvl, ...args) => {
    if (LEVELS[lvl] > threshold) return;
    const ts = paint(colored, ANSI.gray, clock());
    const lvlTag = paint(colored, LEVEL_COLOR[lvl] || ANSI.white, lvl.toUpperCase().padEnd(5));
    const scopeTag = paint(colored, ANSI.dim, scope);
    const prefix = `${ts} ${lvlTag} [${scopeTag}]`;
    const sink = lvl === 'error' ? console.error : console.log;
    sink(prefix, ...args);
  };

  return {
    error: (...a) => emit('error', ...a),
    warn: (...a) => emit('warn', ...a),
    info: (...a) => emit('info', ...a),
    debug: (...a) => emit('debug', ...a),
    child: (childScope) => createLogger(`${scope}:${childScope}`, level),
    color: colored,
    paint: (color, text) => paint(colored, color, text),
    colors: ANSI,
  };
}

module.exports = {
  createLogger,
  useColor,
  paint,
  ANSI,
  LEVELS,
};
