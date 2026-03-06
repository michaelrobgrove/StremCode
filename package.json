/**
 * StremCodes - Xtream Codes API Client
 *
 * Handles all communication with Xtream Codes IPTV servers.
 * Supports: player_api, VOD, Series, Live streams
 */

export class XtreamClient {
  constructor(server, username, password) {
    // Normalize server URL
    this.server = server.replace(/\/$/, '');
    if (!this.server.startsWith('http')) {
      this.server = 'http://' + this.server;
    }
    this.username = username;
    this.password = password;
    this.baseParams = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  }

  get apiUrl() {
    return `${this.server}/player_api.php?${this.baseParams}`;
  }

  async fetch(url, opts = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, {
        ...opts,
        signal: controller.signal,
        headers: {
          'User-Agent': 'StremCodes/1.0',
          ...opts.headers,
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from XC server`);
      }
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Get account info + server info */
  async getPlayerInfo() {
    return this.fetch(`${this.apiUrl}&action=get_server_info`);
  }

  // ─── VOD ─────────────────────────────────────────────────────────────────

  /** Get all VOD categories */
  async getVodCategories() {
    return this.fetch(`${this.apiUrl}&action=get_vod_categories`);
  }

  /** Get VOD streams, optionally filtered by category */
  async getVodStreams(categoryId = null) {
    const cat = categoryId && categoryId !== 'all' ? `&category_id=${categoryId}` : '';
    return this.fetch(`${this.apiUrl}&action=get_vod_streams${cat}`);
  }

  /** Get VOD stream info (includes tmdb_id etc) */
  async getVodInfo(vodId) {
    return this.fetch(`${this.apiUrl}&action=get_vod_info&vod_id=${vodId}`);
  }

  // ─── Series ──────────────────────────────────────────────────────────────

  /** Get all Series categories */
  async getSeriesCategories() {
    return this.fetch(`${this.apiUrl}&action=get_series_categories`);
  }

  /** Get series list, optionally by category */
  async getSeriesList(categoryId = null) {
    const cat = categoryId && categoryId !== 'all' ? `&category_id=${categoryId}` : '';
    return this.fetch(`${this.apiUrl}&action=get_series${cat}`);
  }

  /** Get series info including episodes */
  async getSeriesInfo(seriesId) {
    return this.fetch(`${this.apiUrl}&action=get_series_info&series_id=${seriesId}`);
  }

  // ─── Stream URLs ─────────────────────────────────────────────────────────

  /** Build direct VOD stream URL */
  getVodStreamUrl(streamId, ext = 'mkv') {
    return `${this.server}/movie/${this.username}/${this.password}/${streamId}.${ext}`;
  }

  /** Build series episode stream URL */
  getSeriesStreamUrl(streamId, ext = 'mkv') {
    return `${this.server}/series/${this.username}/${this.password}/${streamId}.${ext}`;
  }

  /** Build live stream URL */
  getLiveStreamUrl(streamId) {
    return `${this.server}/live/${this.username}/${this.password}/${streamId}.m3u8`;
  }
}
