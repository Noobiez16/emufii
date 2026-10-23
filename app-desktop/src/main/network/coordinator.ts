import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { ClientAuth } from './clientAuth.js';

export interface RoomRef {
  host: string;
  port: number;
  password: string;
}

export interface Member {
  id: string;
  name: string;
  forSeconds: number;
  avatar?: string | null;
}

export interface CreatedSession {
  code: string;
  subnet: string;
  token?: string;
  room?: RoomRef | null;
}

export interface RemoteSession {
  code: string;
  subnet: string;
  hostIp?: string | null;
  port?: number | null;
  romTitleId?: string | null;
  romTitle?: string | null;
  hostName?: string | null;
  room?: RoomRef | null;
  emulatorVersion?: string | null;
  romHash?: string | null;
  region?: string | null;
  hostReady: boolean;
  members: Member[];
}

export interface RelayRegion {
  id: string;
  name: string;
  pingHost: string;
}

export interface OpenSession {
  code: string;
  romTitle?: string | null;
  romTitleId?: string | null;
  hostName?: string | null;
  players: number;
  ready: boolean;
  ageSeconds: number;
}

export interface FriendPresence {
  name?: string | null;
  sessionCode?: string | null;
  romTitle?: string | null;
  romTitleId?: string | null;
  players: number;
  ready: boolean;
}

export interface LastGame {
  title: string;
  titleId?: string | null;
  at: number;
}

export interface FriendsReply {
  present: Record<string, FriendPresence>;
  names: Record<string, string>;
  avatars: Record<string, string>;
  lastGames: Record<string, LastGame>;
}

export interface WgTunnelInfo {
  address: string;
  hairpinAddress?: string | null;
  subnet: string;
  relayEndpoint: string;
  relayPublicKey: string;
  relayAllowedIps: string;
}

export interface Heartbeat {
  players: number;
  memberToken?: string | null;
  memberHandle?: string | null;
}

export class CoordinatorError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'CoordinatorError';
  }
}

export class CoordinatorClient {
  private baseUrl: string;
  static identityKey: string | null = null;

  constructor(baseUrl = 'https://coord.emufii.xyz') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async createSession(params: {
    code: string;
    romTitleId?: string | null;
    romTitle?: string | null;
    hostName?: string | null;
    hostId?: string | null;
    console?: string | null;
    isPrivate?: boolean;
    region?: string | null;
    emulatorVersion?: string | null;
    romHash?: string | null;
  }): Promise<CreatedSession> {
    const body: Record<string, any> = { code: params.code };
    if (params.romTitleId) body.rom_title_id = params.romTitleId;
    if (params.romTitle) body.rom_title = params.romTitle;
    if (params.hostName) body.host_name = params.hostName;
    if (params.hostId) {
      body.host_id = params.hostId;
      if (CoordinatorClient.identityKey) body.key = CoordinatorClient.identityKey;
    }
    if (params.console) body.console = params.console;
    if (params.isPrivate) body.private = true;
    if (params.region) body.region = params.region;
    if (params.emulatorVersion) body.emulator_version = params.emulatorVersion;
    if (params.romHash) body.rom_hash = params.romHash;

    const res = await this.request('/sessions', 'POST', body, 15000);
    const json = JSON.parse(res);
    return {
      code: json.code,
      subnet: json.subnet,
      token: json.token,
      room: json.room || null,
    };
  }

  async patchSession(code: string, hostIp: string, port: number, token?: string): Promise<void> {
    await this.request(`/sessions/${code}`, 'PATCH', { host_ip: hostIp, port }, 4000, token);
  }

  async setHostReady(code: string, ready: boolean, token?: string): Promise<void> {
    await this.request(`/sessions/${code}`, 'PATCH', { host_ready: ready }, 4000, token);
  }

  async getSession(code: string): Promise<RemoteSession> {
    const res = await this.request(`/sessions/${code}`, 'GET');
    const json = JSON.parse(res);
    return {
      code: json.code,
      subnet: json.subnet,
      hostIp: json.host_ip || null,
      port: json.port || null,
      romTitleId: json.rom_title_id || null,
      romTitle: json.rom_title || null,
      hostName: json.host_name || null,
      room: json.room || null,
      emulatorVersion: json.emulator_version || null,
      romHash: json.rom_hash || null,
      region: json.region || null,
      hostReady: json.host_ready !== false,
      members: (json.members || []).map((m: any) => ({
        id: m.id,
        name: m.name || 'Joueur',
        forSeconds: m.for_s || 0,
        avatar: m.avatar || null,
      })),
    };
  }

  async checkHealth(): Promise<{ ok: boolean; count?: number; present?: number }> {
    try {
      const res = await this.request('/health', 'GET', undefined, 4000);
      const json = JSON.parse(res);
      return { ok: !!json.ok, count: json.count, present: json.present };
    } catch {
      return { ok: false };
    }
  }

  async listRelays(): Promise<RelayRegion[]> {
    try {
      const res = await this.request('/relays', 'GET');
      const json = JSON.parse(res);
      return (json.relays || []).map((r: any) => ({
        id: r.id,
        name: r.name || r.id,
        pingHost: r.ping_host,
      }));
    } catch {
      return [];
    }
  }

  async listSessions(): Promise<OpenSession[]> {
    try {
      const res = await this.request('/sessions', 'GET');
      const json = JSON.parse(res);
      return (json.sessions || []).map((s: any) => ({
        code: s.code,
        romTitle: s.rom_title || null,
        romTitleId: s.rom_title_id || null,
        hostName: s.host_name || null,
        players: s.players || 0,
        ready: !!s.ready,
        ageSeconds: s.age_s || 0,
      }));
    } catch {
      return [];
    }
  }

  async heartbeat(code: string, id: string, name: string, rttMs?: number | null): Promise<Heartbeat> {
    const body: Record<string, any> = { id, name };
    if (rttMs != null) body.rtt_ms = rttMs;
    if (CoordinatorClient.identityKey) body.key = CoordinatorClient.identityKey;

    const res = await this.request(`/sessions/${code}/members`, 'POST', body);
    const json = JSON.parse(res);
    return {
      players: json.players || 0,
      memberToken: json.member_token || null,
      memberHandle: json.member_handle || null,
    };
  }

  async leaveSession(code: string, id: string, token?: string | null): Promise<void> {
    await this.request(`/sessions/${code}/members/${id}`, 'DELETE', undefined, 4000, token);
  }

  async deleteSession(code: string, token?: string | null): Promise<void> {
    await this.request(`/sessions/${code}`, 'DELETE', undefined, 8000, token);
  }

  async announcePresence(id: string, name: string, inSession = false): Promise<void> {
    const body: Record<string, any> = { id, name, in_session: inSession };
    if (CoordinatorClient.identityKey) body.key = CoordinatorClient.identityKey;
    await this.request('/me', 'POST', body);
  }

  async announceLastGame(id: string, title?: string | null, titleId?: string | null): Promise<void> {
    const body: Record<string, any> = { id };
    if (CoordinatorClient.identityKey) body.key = CoordinatorClient.identityKey;
    if (!title) {
      body.last_game = null;
    } else {
      body.last_game = { title, ...(titleId ? { title_id: titleId } : {}) };
    }
    await this.request('/me', 'POST', body);
  }

  async friendStatuses(codes: string[]): Promise<FriendsReply> {
    if (codes.length === 0) {
      return { present: {}, names: {}, avatars: {}, lastGames: {} };
    }
    const res = await this.request('/friends', 'POST', { ids: codes });
    const json = JSON.parse(res);
    const present: Record<string, FriendPresence> = {};
    for (const f of json.friends || []) {
      const session = f.session || null;
      present[f.id] = {
        name: f.name || null,
        sessionCode: session?.code || null,
        romTitle: session?.rom_title || null,
        romTitleId: session?.rom_title_id || null,
        players: session?.players || 0,
        ready: session?.ready || false,
      };
    }
    const names = json.names || {};
    const avatars = json.avatars || {};
    const lastGames: Record<string, LastGame> = {};
    if (json.last_games) {
      for (const [k, v] of Object.entries<any>(json.last_games)) {
        if (v && v.title) {
          lastGames[k] = { title: v.title, titleId: v.title_id || null, at: v.at || 0 };
        }
      }
    }
    return { present, names, avatars, lastGames };
  }

  async claimAddress(code: string, publicKey: string, name?: string | null, profileId?: string | null): Promise<WgTunnelInfo> {
    const body: Record<string, any> = { public_key: publicKey };
    if (name) body.name = name;
    if (profileId) {
      body.id = profileId;
      if (CoordinatorClient.identityKey) body.key = CoordinatorClient.identityKey;
    }
    const res = await this.request(`/sessions/${code}/peers`, 'POST', body, 15000);
    const json = JSON.parse(res);
    const relay = json.relay;
    if (!relay) throw new CoordinatorError('The coordinator has no relay configured');

    return {
      address: json.ip,
      hairpinAddress: json.hairpin_ip || null,
      subnet: json.subnet,
      relayEndpoint: relay.endpoint,
      relayPublicKey: relay.public_key,
      relayAllowedIps: relay.allowed_ips,
    };
  }

  async uploadAvatar(id: string, key: string, imageBase64: string): Promise<string> {
    const body = { id, key, image: imageBase64 };
    const res = await this.request('/avatar', 'PUT', body, 10000);
    const json = JSON.parse(res);
    return json.hash;
  }

  async deleteAvatar(id: string, key: string): Promise<void> {
    await this.request('/avatar/delete', 'POST', { id, key }, 4000);
  }

  async reportJoinFailure(reason: string, consoleType?: string | null, code?: string | null): Promise<void> {
    try {
      await this.request('/telemetry/join', 'POST', {
        reason,
        ...(consoleType ? { console: consoleType.toLowerCase() } : {}),
        code: code || '',
      });
    } catch {}
  }

  async reportEvent(params: {
    event: string;
    console: string;
    code: string;
    role: string;
    detail?: string | null;
    emu?: string | null;
  }): Promise<void> {
    try {
      await this.request('/telemetry/event', 'POST', {
        event: params.event,
        console: params.console.toLowerCase(),
        code: params.code,
        role: params.role,
        ...(params.detail ? { detail: params.detail } : {}),
        ...(params.emu ? { emu: params.emu } : {}),
      });
    } catch {}
  }

  private async request(
    path: string,
    method: string,
    body?: any,
    timeoutMs = 4000,
    bearer?: string | null
  ): Promise<string> {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    try {
      return await this.sendOnce(path, method, payload, timeoutMs, bearer);
    } catch (err: any) {
      if (err instanceof CoordinatorError && err.status === 403) {
        // If refused on 403, retry once after learning server clock from response
        return await this.sendOnce(path, method, payload, timeoutMs, bearer);
      }
      throw err;
    }
  }

  private sendOnce(
    path: string,
    method: string,
    payload: string | null,
    timeoutMs: number,
    bearer?: string | null
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);
      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;

      const headers: Record<string, string> = {
        'User-Agent': 'Emufii-Desktop/2.0.3',
      };
      if (payload != null) {
        headers['Content-Type'] = 'application/json; charset=utf-8';
        headers['Content-Length'] = Buffer.byteLength(payload).toString();
      }
      if (bearer) {
        headers['Authorization'] = `Bearer ${bearer}`;
      }

      const sig = ClientAuth.sign(method, path, payload);
      if (sig) {
        headers[ClientAuth.HEADER_AUTH] = sig.value;
        headers[ClientAuth.HEADER_TIMESTAMP] = sig.timestamp;
        headers[ClientAuth.HEADER_CLIENT] = ClientAuth.clientVersion;
      }

      const req = transport.request(
        url,
        {
          method,
          headers,
          timeout: timeoutMs,
        },
        (res) => {
          const serverDateStr = res.headers['date'];
          if (serverDateStr) {
            const serverDate = Date.parse(serverDateStr);
            if (!isNaN(serverDate)) {
              ClientAuth.learnServerClock(serverDate, Date.now() - 100, Date.now());
            }
          }

          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const bodyStr = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode || 0;
            if (status === 404) {
              return reject(new CoordinatorError('Session not found', 404));
            }
            if (status < 200 || status >= 300) {
              return reject(new CoordinatorError(`HTTP ${status}: ${bodyStr}`, status));
            }
            resolve(bodyStr);
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        reject(new CoordinatorError('Request timeout'));
      });
      req.on('error', (err) => {
        reject(new CoordinatorError(err.message));
      });

      if (payload != null) {
        req.write(payload);
      }
      req.end();
    });
  }
}
