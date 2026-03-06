/**
 * Xtream Codes API client
 */
export class XtreamClient {
  constructor(server, username, password) {
    this.server = server.replace(/\/$/, '');
    if (!this.server.startsWith('http')) this.server = 'http://' + this.server;
    this.username = username;
    this.password = password;
    this._base = this.server + '/player_api.php?username=' +
      encodeURIComponent(username) + '&password=' + encodeURIComponent(password);
  }

  async _fetch(url, timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'StremCodes/2.0' } });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        console.log('XC HTTP error', r.status, url.split('?')[0], body.slice(0, 100));
        throw new Error('HTTP ' + r.status);
      }
      const text = await r.text();
      try {
        return JSON.parse(text);
      } catch {
        console.log('XC non-JSON response:', text.slice(0, 150));
        throw new Error('Non-JSON response from server');
      }
    } finally { clearTimeout(t); }
  }

  getPlayerInfo()         { return this._fetch(this._base + '&action=get_server_info'); }
  getVodStreams()          { return this._fetch(this._base + '&action=get_vod_streams', 60000); }
  getSeriesList()          { return this._fetch(this._base + '&action=get_series', 60000); }
  getVodInfo(id)           { return this._fetch(this._base + '&action=get_vod_info&vod_id=' + id); }
  getSeriesInfo(id)        { return this._fetch(this._base + '&action=get_series_info&series_id=' + id); }

  vodUrl(streamId, ext)    { return this.server + '/movie/' + this.username + '/' + this.password + '/' + streamId + '.' + (ext||'mkv'); }
  seriesUrl(streamId, ext) { return this.server + '/series/' + this.username + '/' + this.password + '/' + streamId + '.' + (ext||'mkv'); }
}
