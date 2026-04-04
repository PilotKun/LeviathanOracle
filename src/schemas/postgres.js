const { Pool } = require('pg');
const config = require('../../config.json');
const tracer = require('../utils/tracer');

const dbConfig = config.database.postgressql;

if (!dbConfig?.enabled) {
  tracer.info('DATABASE: PostgreSQL', 'PostgreSQL is disabled, using local database.');
  module.exports = { type: 'postgres', query: () => {}, getClient: () => {}, pool: null };
} else {

const pool = new Pool({
  ...dbConfig.config,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.query(`
  CREATE TABLE IF NOT EXISTS watchlists (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    discord_username TEXT,
    anime_title TEXT NOT NULL,
    anime_id INTEGER,
    UNIQUE(user_id, anime_title)
  );
  
  CREATE TABLE IF NOT EXISTS user_profiles (
    id SERIAL PRIMARY KEY, user_id VARCHAR(255) NOT NULL UNIQUE,
    mal_username VARCHAR(255), anilist_username VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id VARCHAR(255) PRIMARY KEY,
    notification_type VARCHAR(50) DEFAULT 'dm',
    watchlist_visibility VARCHAR(50) DEFAULT 'private',
    notification_channel_id VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS role_notifications (
    id SERIAL PRIMARY KEY,
    role_id VARCHAR(255) NOT NULL,
    guild_id VARCHAR(255) NOT NULL,
    anime_title TEXT NOT NULL,
    anime_id INTEGER,
    UNIQUE(role_id, anime_id)
  );

  CREATE TABLE IF NOT EXISTS schedules (
    anime_id INTEGER PRIMARY KEY,
    anime_title TEXT NOT NULL,
    next_airing_at BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id VARCHAR(255) PRIMARY KEY,
    notification_channel_id VARCHAR(255),
    daily_schedule_channel_id VARCHAR(255),
    daily_schedule_enabled VARCHAR(10) DEFAULT 'false',
    level_role_id VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_watchlists_user_id ON watchlists(user_id);
  CREATE INDEX IF NOT EXISTS idx_watchlists_anime_title ON watchlists(anime_title);
  CREATE INDEX IF NOT EXISTS idx_role_notifications_guild ON role_notifications(guild_id);
  CREATE INDEX IF NOT EXISTS idx_role_notifications_anime_title ON role_notifications(anime_title);
  CREATE INDEX IF NOT EXISTS idx_role_notifications_anime_id ON role_notifications(anime_id);
  CREATE INDEX IF NOT EXISTS idx_schedules_next_airing ON schedules(next_airing_at);
  CREATE INDEX IF NOT EXISTS idx_schedules_anime_title ON schedules(anime_title);

  ALTER TABLE schedules ADD COLUMN IF NOT EXISTS sent_at BIGINT DEFAULT NULL;
`).catch(err => tracer.error('DATABASE: PostgreSQL', 'PostgreSQL init error', err));

  module.exports = {
    type: 'postgres',
    query: (text, params) => pool.query(text, params),
    getClient: () => pool.connect(),
    pool,
  };
}