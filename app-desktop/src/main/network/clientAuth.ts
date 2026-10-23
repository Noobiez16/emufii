import crypto from 'node:crypto';

/**
 * Client authentication matching ClientAuth.kt from app-android:
 * HMAC-SHA256(secret, method\npath\ntimestamp\nSHA-256(body)), lowercase hex.
 */
export class ClientAuth {
  static readonly HEADER_AUTH = 'X-Emufii-Auth';
  static readonly HEADER_TIMESTAMP = 'X-Emufii-Ts';
  static readonly HEADER_CLIENT = 'X-Emufii-Client';

  private static secret: string =
    process.env.EMUFII_CLIENT_SECRET || '5874223c55d123ea987ef3df427734c7e848e61165eb58452f25699b46ce1ae7';
  static clientVersion: string = '54'; // VersionCode 54 (matches Emufii v2.0.3)

  private static clockOffsetMs: number = 0;
  private static readonly CLOCK_TOLERANCE_MS = 5000;

  static setSecret(secret: string) {
    this.secret = secret;
  }

  static isConfigured(): boolean {
    return this.secret.length > 0;
  }

  static nowSeconds(): number {
    return Math.floor((Date.now() + this.clockOffsetMs) / 1000);
  }

  static learnServerClock(serverDateMs: number, sentAtMs: number, receivedAtMs: number): boolean {
    if (serverDateMs <= 0) return false;
    const offset = serverDateMs - Math.floor((sentAtMs + receivedAtMs) / 2);
    if (Math.abs(offset - this.clockOffsetMs) < this.CLOCK_TOLERANCE_MS) return false;
    this.clockOffsetMs = offset;
    return true;
  }

  static sign(method: string, path: string, body?: string | null, timestampSeconds = this.nowSeconds()) {
    if (!this.isConfigured()) return null;

    const bodyHash = crypto.createHash('sha256').update(body || '', 'utf8').digest('hex');
    const payload = `${method.toUpperCase()}\n${path}\n${timestampSeconds}\n${bodyHash}`;
    const signature = crypto.createHmac('sha256', this.secret).update(payload, 'utf8').digest('hex');

    return {
      value: signature,
      timestamp: timestampSeconds.toString(),
    };
  }
}
