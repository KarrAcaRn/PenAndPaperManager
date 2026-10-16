import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { LOGIN_CODE_LENGTH } from '@pnp/shared';
import { getRow, insertRow, run, transaction, type Db } from './db.ts';
import { tooManyRequests } from './errors.ts';

/** Gültigkeit eines Codes */
export const LOGIN_CODE_MINUTES = 10;
/** Nach so vielen falschen Eingaben ist ein Code verbrannt */
export const MAX_FAILED_ATTEMPTS = 5;

/** Rate-Limits für das Anfordern von Codes */
export const RATE_LIMITS = {
  emailPerMinute: 1,
  emailPerHour: 5,
  ipPerHour: 20,
} as const;

/**
 * Verschickt den Code an die Adresse. Die echte Implementierung (SMTP bzw. Konsole im Dev-Betrieb) kommt aus einem
 * eigenen Modul und wird über `buildApp(db, { sendLoginCodeEmail })` eingehängt; bis dahin gilt der Stub unten.
 */
export type SendLoginCodeEmail = (email: string, code: string) => Promise<void>;

/** Stub: im Dev-Betrieb Code auf die Konsole, in Produktion Fehler (der Versand ist dort noch nicht eingerichtet). */
export const stubSendLoginCodeEmail: SendLoginCodeEmail = async (email, code) => {
  if (process.env.NODE_ENV === 'production') throw new Error('Mailversand für Login-Codes ist nicht eingerichtet');
  console.info(`[Login-Code] ${email}: ${code}`);
};

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Gleichverteilter Code aus Ziffern, mit führenden Nullen, aus dem kryptografischen Zufallsgenerator */
export function generateCode(): string {
  return randomInt(0, 10 ** LOGIN_CODE_LENGTH).toString().padStart(LOGIN_CODE_LENGTH, '0');
}

// scrypt statt eines schnellen Hashs: bei nur 10^6 möglichen Codes soll ein DB-Leak nicht in Sekunden knackbar sein.
const hashCode = (code: string, salt: string): Buffer => scryptSync(code, Buffer.from(salt, 'hex'), 32);

/**
 * Prüft die Rate-Limits und legt einen neuen Code an; ältere offene Codes der Adresse werden ungültig.
 * Liefert den Klartext-Code zum Versand – er wird nirgends gespeichert.
 */
export function issueLoginCode(db: Db, rawEmail: string, ip: string): string {
  const email = normalizeEmail(rawEmail);
  const code = generateCode();
  const salt = randomBytes(16).toString('hex');
  const hash = hashCode(code, salt).toString('hex');
  transaction(db, () => {
    // Aufräumen: fürs Rate-Limiting reicht die letzte Stunde
    run(db, `DELETE FROM login_codes WHERE created_at < datetime('now', '-1 day')`);
    const count = (where: string, value: string, window: string) =>
      getRow<{ n: number }>(db, `SELECT COUNT(*) AS n FROM login_codes WHERE ${where} = ? AND created_at > datetime('now', ?)`, value, window)!.n;
    if (count('email', email, '-60 seconds') >= RATE_LIMITS.emailPerMinute) {
      throw tooManyRequests('Bitte warte eine Minute, bevor du einen neuen Code anforderst');
    }
    if (count('email', email, '-1 hour') >= RATE_LIMITS.emailPerHour) throw tooManyRequests();
    if (count('ip', ip, '-1 hour') >= RATE_LIMITS.ipPerHour) throw tooManyRequests();

    run(
      db,
      `UPDATE login_codes SET invalidated_at = datetime('now')
       WHERE email = ? AND consumed_at IS NULL AND invalidated_at IS NULL`,
      email,
    );
    insertRow(
      db,
      `INSERT INTO login_codes (email, code_salt, code_hash, ip, expires_at) VALUES (?, ?, ?, ?, datetime('now', ?))`,
      email,
      salt,
      hash,
      ip,
      `+${LOGIN_CODE_MINUTES} minutes`,
    );
  });
  return code;
}

interface CodeRow {
  id: number;
  codeSalt: string;
  codeHash: string;
}

/**
 * Löst einen Code ein. Liefert true bei Erfolg (der Code ist danach verbraucht), sonst false – ohne zu verraten, ob
 * der Code falsch, abgelaufen, schon benutzt oder durch zu viele Fehlversuche gesperrt war.
 */
export function consumeLoginCode(db: Db, rawEmail: string, rawCode: string): boolean {
  const email = normalizeEmail(rawEmail);
  const code = rawCode.trim();
  return transaction(db, () => {
    const row = getRow<CodeRow>(
      db,
      `SELECT id, code_salt AS codeSalt, code_hash AS codeHash FROM login_codes
       WHERE email = ? AND consumed_at IS NULL AND invalidated_at IS NULL
         AND expires_at > datetime('now') AND failed_attempts < ?
       ORDER BY id DESC LIMIT 1`,
      email,
      MAX_FAILED_ATTEMPTS,
    );
    if (!row) return false;
    const expected = Buffer.from(row.codeHash, 'hex');
    if (!timingSafeEqual(hashCode(code, row.codeSalt), expected)) {
      run(db, 'UPDATE login_codes SET failed_attempts = failed_attempts + 1 WHERE id = ?', row.id);
      return false;
    }
    run(db, `UPDATE login_codes SET consumed_at = datetime('now') WHERE id = ?`, row.id);
    return true;
  });
}
