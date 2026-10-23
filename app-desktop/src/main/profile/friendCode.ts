/**
 * Eleven Crockford base32 symbols plus a check symbol.
 * Exactly mirrors FriendCode.kt from app-android.
 * Safe for both Node.js and Browser environments.
 */
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RANDOM_SYMBOLS = 11;
export const LENGTH = RANDOM_SYMBOLS + 1;
const GROUP = 4;

export function generateFriendCode(): string {
  let body = '';
  const bytes = new Uint8Array(RANDOM_SYMBOLS);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < RANDOM_SYMBOLS; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  for (let i = 0; i < RANDOM_SYMBOLS; i++) {
    body += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return body + checksum(body);
}

export function formatFriendCode(code: string): string {
  const parts: string[] = [];
  for (let i = 0; i < code.length; i += GROUP) {
    parts.push(code.substring(i, i + GROUP));
  }
  return parts.join('-');
}

export function normalizeFriendCode(input: string): string | null {
  let cleaned = '';
  for (const raw of input) {
    if (raw === '-' || raw === ' ' || raw === '\t' || raw === '\n' || raw === '\r') {
      continue;
    }
    const upper = raw.toUpperCase();
    if (upper === 'O') {
      cleaned += '0';
    } else if (upper === 'I' || upper === 'L') {
      cleaned += '1';
    } else {
      cleaned += upper;
    }
  }

  if (cleaned.length !== LENGTH) return null;
  for (const char of cleaned) {
    if (!ALPHABET.includes(char)) return null;
  }
  const body = cleaned.substring(0, RANDOM_SYMBOLS);
  if (cleaned[LENGTH - 1] !== checksum(body)) return null;
  return cleaned;
}

export function isValidFriendCode(input: string): boolean {
  return normalizeFriendCode(input) !== null;
}

function checksum(body: string): string {
  let acc = 0;
  for (let index = 0; index < body.length; index++) {
    acc += ALPHABET.indexOf(body[index]) * (index + 1);
  }
  return ALPHABET[acc % ALPHABET.length];
}
