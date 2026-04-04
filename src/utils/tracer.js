/**
 * tracer.js — Lightweight structured tracer for LeviathanOracle
 *
 * Usage:
 *   const tracer = require('./tracer');
 *   const t = tracer.start('scheduler:send', { anime_id: 123 });
 *   t.info('Sending notification');
 *   t.error('Failed', err);
 *   t.end();                 // logs duration
 *   t.end('Completed ok');   // logs duration + message
 *
 * Stand-alone log (no span):
 *   tracer.info('linkprofile', 'User linked MAL', { userId, username });
 *   tracer.warn('scheduler', 'Skipped duplicate send', { anime_id });
 *   tracer.error('db', 'Query failed', err);
 */

const chalkModule = (() => { try { return require('chalk'); } catch { return null; } })();
const chalk = chalkModule?.default || chalkModule;

const COLORS = {
  debug:   (s) => chalk?.grey?.(s)    ?? s,
  trace:   (s) => chalk?.magenta?.(s) ?? s,
  info:    (s) => chalk?.cyan?.(s)    ?? s,
  warn:    (s) => chalk?.yellow?.(s)  ?? s,
  error:   (s) => chalk?.red?.(s)     ?? s,
  dim:     (s) => chalk?.dim?.(s)     ?? s,
  bold:    (s) => chalk?.bold?.(s)    ?? s,
};

const LEVELS = {
  debug: { priority: 0, label: 'DEBUG' },
  trace: { priority: 1, label: 'TRACE' },
  info:  { priority: 2, label: 'INFO ' },
  warn:  { priority: 3, label: 'WARN ' },
  error: { priority: 4, label: 'ERROR' },
};

const DEFAULT_LEVEL = process.env.LOG_LEVEL?.toLowerCase() || 'info';
const MIN_PRIORITY = LEVELS[DEFAULT_LEVEL]?.priority ?? 2;

/**
 * Core Logging Logic
 */
function _log(level, context, message, meta) {
  const cfg = LEVELS[level] || LEVELS.info;
  if (cfg.priority < MIN_PRIORITY) return;

  const ts = COLORS.dim(new Date().toISOString());
  const ctx = context ? COLORS.bold(`[${context}]`) : '';
  const header = COLORS[level](`${cfg.label} │ ${ctx} ${message}`);
  
  const output = [`${ts} ${header}`];

  if (meta instanceof Error) {
    output.push(COLORS.error(meta.stack || meta.message));
  } else if (meta !== undefined) {
    const detail = typeof meta === 'object' ? JSON.stringify(meta) : String(meta);
    output.push(COLORS.dim(detail));
  }

  const method = level === 'trace' ? 'debug' : level;
  console[method === 'warn' ? 'warn' : method === 'error' ? 'error' : 'log'](...output);
}

/**
 * Public API
 */
const tracer = {
  start(context, meta) {
    const t0 = Date.now();
    _log('trace', context, 'started', meta);

    const span = {};
    Object.keys(LEVELS).forEach(level => {
      span[level] = (msg, m) => _log(level, context, msg, m);
    });

    span.end = (msg = 'finished', m) => {
      const duration = COLORS.dim(` (${Date.now() - t0}ms)`);
      _log('trace', context, msg + duration, m);
    };

    return span;
  }
};

// Map standalone methods: tracer.info(ctx, msg, meta)
Object.keys(LEVELS).forEach(level => {
  tracer[level] = (ctx, msg, meta) => _log(level, ctx, msg, meta);
});

module.exports = tracer;
