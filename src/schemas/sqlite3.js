const Database = require('better-sqlite3');
const path = require('path');
const tracer = require('../utils/tracer');

const db = new Database(path.resolve(__dirname, '..', '..', 'localdb.db'));

try {
  db.exec(`
  CREATE TABLE IF NOT EXISTS watchlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    discord_username TEXT,
    anime_title TEXT NOT NULL,
    anime_id INTEGER,
    UNIQUE(user_id, anime_title)
  );

  CREATE TABLE IF NOT EXISTS user_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE,
    mal_username TEXT,
    anilist_username TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY,
    notification_type TEXT DEFAULT 'dm',
    watchlist_visibility TEXT DEFAULT 'private',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS role_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    anime_title TEXT NOT NULL,
    anime_id INTEGER,
    role_notification_channel_id TEXT,
    UNIQUE(role_id, anime_id)
  );

  CREATE TABLE IF NOT EXISTS schedules (
    anime_id INTEGER PRIMARY KEY,
    anime_title TEXT NOT NULL,
    next_airing_at INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    daily_schedule_channel_id TEXT,
    daily_schedule_enabled TEXT DEFAULT 'false',
    level_role_id TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_watchlists_user_id ON watchlists(user_id);
  CREATE INDEX IF NOT EXISTS idx_watchlists_anime_title ON watchlists(anime_title);
  CREATE INDEX IF NOT EXISTS idx_role_notifications_guild ON role_notifications(guild_id);
  CREATE INDEX IF NOT EXISTS idx_role_notifications_anime_title ON role_notifications(anime_title);
  CREATE INDEX IF NOT EXISTS idx_role_notifications_anime_id ON role_notifications(anime_id);
  CREATE INDEX IF NOT EXISTS idx_schedules_next_airing ON schedules(next_airing_at);
  CREATE INDEX IF NOT EXISTS idx_schedules_anime_title ON schedules(anime_title);
`);

  const scheduleColumns = db.prepare(`PRAGMA table_info(schedules)`).all();
  const hasSentAt = scheduleColumns.some(col => col.name === 'sent_at');
  if (!hasSentAt) {
    db.exec(`ALTER TABLE schedules ADD COLUMN sent_at INTEGER DEFAULT NULL;`);
  }

  tracer.info('DATABASE: SQLite3', 'SQLite schema initialized');
} catch (err) {
  tracer.error('DATABASE: SQLite3', 'SQLite schema init failed', err);
  throw err;
}

module.exports = {
  type: 'sqlite',
  query: async (text, params = []) => {
    try {
      const refs = [];
      const sql = text.replace(/\$\d+/g, m => { refs.push(parseInt(m.slice(1)) - 1); return '?'; }).trim();
      const expanded = refs.length ? refs.map(i => params[i]) : params;
      const stmt = db.prepare(sql.replace(/\s+RETURNING\s+.+$/i, ''));

      if (/^SELECT/i.test(sql)) {
        const rows = stmt.all(...expanded);
        return { rows, rowCount: rows.length };
      }

      const info = stmt.run(...expanded);
      const rows = /RETURNING/i.test(sql) ? [{ id: info.lastInsertRowid }] : [];
      return { rows, rowCount: info.changes };
    } catch (err) {
      const compactSql = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 220);
      tracer.error('DATABASE: SQLite3', `Query failed: ${compactSql}`, err);
      throw err;
    }
  },
  db
};