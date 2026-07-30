import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { getEnv } from './env';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_KEYLEN = 64;

/**
 * Password hashing with scrypt from node:crypto — no native build step, and
 * memory-hard by design. Format: `scrypt$<saltHex>$<keyHex>`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const actual = await scrypt(password, salt, SCRYPT_KEYLEN);
  return timingSafeEqual(actual, expected);
}

/** Opaque, high-entropy token for sessions and invitations. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Session/invite tokens are stored only as SHA-256 digests, so a database dump
 * cannot be replayed as a live session.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function encryptionKey(): Buffer {
  return Buffer.from(getEnv().ENCRYPTION_KEY, 'hex');
}

/** AES-256-GCM. Output: `v1.<ivB64>.<tagB64>.<cipherB64>` */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Malformed encrypted payload');
  }
  const iv = Buffer.from(parts[1]!, 'base64');
  const tag = Buffer.from(parts[2]!, 'base64');
  const data = Buffer.from(parts[3]!, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T>(payload: string): T {
  return JSON.parse(decryptSecret(payload)) as T;
}
