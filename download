/**
 * StremCodes - Xtream Codes API Client v1.4
 */

export class XtreamClient {
  constructor(server, username, password) {
    this.server = server.replace(/\/$/, '');
    if (!this.server.startsWith('http')) {
      this.server = 'http://' + this.server;
    }
    this.username = username;
    this.password = password;
    this.baseParams = 'username=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password);
  }

  get apiUrl() {
    return this.server + '/player_api.php?' + this.baseParams;
  }

  async fetch(url, opts) {
    opts = opts || {};
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        signal: opts.signal || controller.signal,
        headers: { 'User-Agent': 'StremCodes/1.4' },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async getPlayerInfo() {
    return this.fetch(this.apiUrl + '&action=get_server_info');
  }

  async getVodCategories() {
    return this.fetch(this.apiUrl + '&action=get_vod_categories');
  }

  // Standard fetch (15s timeout built in)
  async getVodStreams(categoryId) {
    const cat = categoryId && categoryId !== 'all' ? '&category_id=' + categoryId : '';
    return this.fetch(this.apiUrl + '&action=get_vod_streams' + cat);
  }

  // Raw fetch with caller-supplied AbortSignal (for custom timeout control)
  async getVodStreamsRaw(signal) {
    const res = await fetch(this.apiUrl + '&action=get_vod_streams', {
      signal: signal,
      headers: { 'User-Agent': 'StremCodes/1.4' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async getVodInfo(vodId) {
    return this.fetch(this.apiUrl + '&action=get_vod_info&vod_id=' + vodId);
  }

  async getSeriesCategories() {
    return this.fetch(this.apiUrl + '&action=get_series_categories');
  }

  async getSeriesList(categoryId) {
    const cat = categoryId && categoryId !== 'all' ? '&category_id=' + categoryId : '';
    return this.fetch(this.apiUrl + '&action=get_series' + cat);
  }

  // Raw fetch with caller-supplied AbortSignal
  async getSeriesListRaw(signal) {
    const res = await fetch(this.apiUrl + '&action=get_series', {
      signal: signal,
      headers: { 'User-Agent': 'StremCodes/1.4' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async getSeriesInfo(seriesId) {
    return this.fetch(this.apiUrl + '&action=get_series_info&series_id=' + seriesId);
  }

  getVodStreamUrl(streamId, ext) {
    ext = ext || 'mkv';
    return this.server + '/movie/' + this.username + '/' + this.password + '/' + streamId + '.' + ext;
  }

  getSeriesStreamUrl(streamId, ext) {
    ext = ext || 'mkv';
    return this.server + '/series/' + this.username + '/' + this.password + '/' + streamId + '.' + ext;
  }

  getLiveStreamUrl(streamId) {
    return this.server + '/live/' + this.username + '/' + this.password + '/' + streamId + '.m3u8';
  }
}
