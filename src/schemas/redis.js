const Redis = require('ioredis');
const config = require('../../config.json');
const tracer = require('../utils/tracer');

const rdConfig = config.database.redis;

if (!rdConfig?.enabled) {
  tracer.info('DATABASE: Redis', 'Redis is disabled, caching will not be applied.');
}

const client = rdConfig?.enabled ? new Redis({
  ...rdConfig.config,
  retryStrategy: times => Math.min(times * 50, 2000)
}) : null;

if (client) {
  client.on('error', err => tracer.error('DATABASE: Redis', 'Redis error', err));
  client.on('ready', () => tracer.info('DATABASE: Redis', 'Redis connected'));
}

module.exports = {
  get: (key) => client?.get(key),
  set: (key, val, opt) => opt?.EX ? client?.set(key, val, 'EX', opt.EX) : client?.set(key, val),
  del: (key) => client?.del(key),
  exists: (key) => client?.exists(key),
  client,
};
