import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Verschlüsselung von Geheimnissen in der Datenbank (z.B. Zugangsdaten externer Speicher).
// AES-256-GCM: vertraulich und manipulationssicher; "aad" bindet den Geheimtext an seinen Zweck/Besitzer,
// damit er nicht in eine fremde Zeile kopiert werden kann.

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const VERSION = 'v1';

export interface SecretBox {
  encrypt(plain: string, aad: string): string;
  /** wirft, wenn der Schlüssel nicht passt oder der Geheimtext verändert wurde */
  decrypt(sealed: string, aad: string): string;
}

export function createSecretBox(key: Buffer): SecretBox {
  if (key.length !== KEY_BYTES) throw new Error(`Der Schlüssel muss ${KEY_BYTES} Bytes lang sein`);
  return {
    encrypt(plain, aad) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return [VERSION, iv, cipher.getAuthTag(), data].map((part) => (typeof part === 'string' ? part : part.toString('base64'))).join(':');
    },
    decrypt(sealed, aad) {
      const [version, iv, tag, data] = sealed.split(':');
      if (version !== VERSION || iv === undefined || tag === undefined || data === undefined) {
        throw new Error('Unbekanntes Format verschlüsselter Daten');
      }
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    },
  };
}

/** Schlüsseldatei neben der Datenbank, falls APP_SECRET_KEY nicht gesetzt ist */
export const secretKeyFile = (dbFile: string) => join(dirname(dbFile), 'secret.key');

/**
 * Schlüssel aus APP_SECRET_KEY (Base64, 32 Bytes) oder aus data/secret.key; fehlt beides, wird die Datei mit einem
 * Zufallsschlüssel angelegt (nur für den Besitzer lesbar). Geht der Schlüssel verloren, sind alle gespeicherten
 * Zugangsdaten unbrauchbar und die Nutzer müssen ihre Speicher neu verbinden.
 */
export function loadSecretKey(dbFile: string, env: string | undefined = process.env.APP_SECRET_KEY): Buffer {
  if (env) return parseKey(env, 'APP_SECRET_KEY');
  const file = secretKeyFile(dbFile);
  if (existsSync(file)) return parseKey(readFileSync(file, 'utf8'), file);
  mkdirSync(dirname(file), { recursive: true });
  const key = randomBytes(KEY_BYTES);
  // wx: nie eine Datei überschreiben, die ein paralleler Prozess gerade angelegt hat
  try {
    writeFileSync(file, `${key.toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return parseKey(readFileSync(file, 'utf8'), file);
    throw err;
  }
  return key;
}

function parseKey(text: string, source: string): Buffer {
  const key = Buffer.from(text.trim(), 'base64');
  if (key.length !== KEY_BYTES) throw new Error(`${source}: erwartet werden ${KEY_BYTES} Bytes als Base64`);
  return key;
}
