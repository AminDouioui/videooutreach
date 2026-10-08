import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { getEnv } from './env';

function schluessel(): Buffer {
  return Buffer.from(getEnv().ENCRYPTION_KEY, 'hex');
}

/** AES-256-GCM. Format: base64(iv[12] | tag[16] | ciphertext) */
export function encrypt(klartext: string, key: Buffer = schluessel()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(klartext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decrypt(payload: string, key: Buffer = schluessel()): string {
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < 29) throw new Error('Ungültiger verschlüsselter Wert');
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

/** IP nur gesalzen gehasht speichern: sha256(salt + ip) */
export function hashIp(ip: string, salt: string = getEnv().IP_HASH_SALT): string {
  return createHash('sha256').update(salt + ip).digest('hex');
}
