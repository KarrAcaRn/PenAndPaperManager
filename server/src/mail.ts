import nodemailer from 'nodemailer';

/** Wie lange ein Login-Code gültig ist (Minuten) – steht so auch in der E-Mail. */
export const LOGIN_CODE_VALID_MINUTES = 10;

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Verschickt eine fertige Nachricht; wirft bei Fehlern. */
export type MailSender = (message: MailMessage) => Promise<void>;

/** Minimale Logger-Schnittstelle (passt zu `console` und zum Fastify-Logger). */
export interface MailLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

type Env = Record<string, string | undefined>;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Baut Betreff, Text- und HTML-Fassung der Login-Code-E-Mail. */
export function loginCodeEmail(code: string, validMinutes = LOGIN_CODE_VALID_MINUTES): Omit<MailMessage, 'to'> {
  const subject = `Dein Login-Code: ${code}`;
  const validity = `Der Code ist ${validMinutes} Minuten gültig.`;
  const ignore = 'Falls du diesen Login nicht angefordert hast, kannst du diese E-Mail einfach ignorieren.';
  const text = [
    'Hallo,',
    '',
    'hier ist dein Login-Code für den Pen & Paper Manager:',
    '',
    `    ${code}`,
    '',
    validity,
    '',
    ignore,
  ].join('\n');
  const c = escapeHtml(code);
  const html = `<!doctype html>
<html lang="de">
<body style="font-family: sans-serif; color: #222; line-height: 1.5;">
  <p>Hallo,</p>
  <p>hier ist dein Login-Code für den Pen &amp; Paper Manager:</p>
  <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; font-family: monospace; margin: 24px 0;">${c}</p>
  <p>${escapeHtml(validity)}</p>
  <p style="color: #666; font-size: 13px;">${escapeHtml(ignore)}</p>
</body>
</html>
`;
  return { subject, text, html };
}

/**
 * Wählt den Versandweg anhand der Umgebungsvariablen:
 * - `MAIL_TRANSPORT=smtp` oder gesetztes `SMTP_HOST`: Versand per SMTP
 *   (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`).
 * - `MAIL_TRANSPORT=log` oder (ohne SMTP-Konfiguration) `NODE_ENV` ≠ `production`: kein Versand,
 *   Empfänger, Betreff und Text (inkl. Code) werden nur ins Log geschrieben.
 * - Produktion ohne SMTP-Konfiguration: jeder Versand schlägt mit einem Fehler fehl.
 */
export function createMailSender(env: Env = process.env, log: MailLogger = console): MailSender {
  const mode = env.MAIL_TRANSPORT || (env.SMTP_HOST ? 'smtp' : env.NODE_ENV === 'production' ? 'none' : 'log');

  if (mode === 'log') {
    return async (m) => {
      log.info(`[Mail – nicht versendet] An: ${m.to} | Betreff: ${m.subject}\n${m.text}`);
    };
  }

  if (mode === 'smtp') {
    if (!env.SMTP_HOST) throw new Error('MAIL_TRANSPORT=smtp, aber SMTP_HOST ist nicht gesetzt.');
    const port = Number(env.SMTP_PORT || 587);
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
    });
    const from = env.MAIL_FROM || env.SMTP_USER;
    if (!from) throw new Error('MAIL_FROM ist nicht gesetzt.');
    return async (m) => {
      await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text, html: m.html });
    };
  }

  if (mode === 'none') {
    return async () => {
      throw new Error('Kein E-Mail-Versand konfiguriert (SMTP_HOST fehlt).');
    };
  }

  throw new Error(`Unbekannter MAIL_TRANSPORT „${mode}“ (erlaubt: smtp, log).`);
}

let sender: MailSender | undefined;
let logger: MailLogger = console;

/**
 * Ersetzt den Versandweg, z.B. in Tests, um verschickte Nachrichten (und damit Codes) abzugreifen.
 * `undefined` stellt den Standard aus den Umgebungsvariablen wieder her.
 */
export function setMailSender(next: MailSender | undefined, log: MailLogger = console): void {
  sender = next;
  logger = log;
}

/**
 * Schickt `email` den Login-Code `code` (Betreff „Dein Login-Code: …“, Text- und HTML-Fassung,
 * Hinweis auf die Gültigkeit von {@link LOGIN_CODE_VALID_MINUTES} Minuten).
 *
 * Der Versandweg kommt aus {@link createMailSender} (im Dev-Modus nur Konsolen-Log, ohne Zugangsdaten).
 * Fehler beim Versand werden geloggt – ohne den Code – und weitergeworfen, damit der Aufrufer reagieren kann.
 */
export async function sendLoginCodeEmail(email: string, code: string): Promise<void> {
  try {
    sender ??= createMailSender(process.env, logger);
    await sender({ to: email, ...loginCodeEmail(code) });
  } catch (err) {
    logger.error(`Login-Code-E-Mail an ${email} konnte nicht versendet werden: ${(err as Error).message}`);
    throw err;
  }
}
