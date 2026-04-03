/**
 * Utility for Watchlist Exports and Imports
 */
module.exports = {
  toMalXML: (rows) => {
    const entries = rows.map(r => `
      <anime>
        <series_animedb_id>${r.anime_id || 0}</series_animedb_id>
        <series_title><![CDATA[${r.anime_title}]]></series_title>
        <my_status>Plan to Watch</my_status>
      </anime>`).join('');
    
    return `<?xml version="1.0" encoding="UTF-8"?>\n<myanimelist>\n<myinfo><user_export_type>1</user_export_type></myinfo>${entries}\n</myanimelist>`;
  },

// Generates an AniList-compatible JSON string
  toAniListJSON: (rows) => JSON.stringify({
    entries: rows.map(r => ({ anilistId: r.anime_id, title: r.anime_title }))
  }, null, 2),

// Parses various file formats into a unified entry list
  parseImport: (format, data) => {
    if (format === 'mal') {
      return (data.match(/<series_animedb_id>(\d+)<\/series_animedb_id>/g) || [])
        .map(tag => ({ id: tag.match(/\d+/)[0], type: 'mal' }));
    }
    
    // Default to JSON/AniList
    try {
      const json = JSON.parse(data);
      return (json.entries || []).map(e => ({ id: e.anilistId, title: e.title, type: 'ani' }));
    } catch {
      return null;
    }
  }
};
