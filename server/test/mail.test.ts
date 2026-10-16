import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMailSender,
  loginCodeEmail,
  LOGIN_CODE_VALID_MINUTES,
  sendLoginCodeEmail,
  setMailSender,
  type MailMessage,
} from '../src/mail.ts';

const fakeLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

afterEach(() => setMailSender(undefined));

describe('loginCodeEmail', () => {
  it('enthält Code, Gültigkeit und Ignorier-Hinweis in Text und HTML', () => {
    const mail = loginCodeEmail('123456');
    expect(LOGIN_CODE_VALID_MINUTES).toBe(10);
    expect(mail.subject).toBe('Dein Login-Code: 123456');
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain('123456');
      expect(body).toContain('10 Minuten gültig');
      expect(body).toContain('nicht angefordert');
    }
    expect(mail.html).toMatch(/<p style="font-size: 32px[^>]*>123456<\/p>/);
  });

  it('maskiert HTML im Code', () => {
    expect(loginCodeEmail('<b>').html).toContain('&lt;b&gt;');
  });
});

describe('createMailSender', () => {
  const msg: MailMessage = { to: 'a@example.org', ...loginCodeEmail('424242') };

  it('loggt im Dev-Modus nur, ohne Zugangsdaten', async () => {
    const log = fakeLog();
    await createMailSender({ NODE_ENV: 'development' }, log)(msg);
    expect(log.info).toHaveBeenCalledOnce();
    expect(log.info.mock.calls[0][0]).toContain('a@example.org');
    expect(log.info.mock.calls[0][0]).toContain('424242');
  });

  it('verweigert in Produktion ohne SMTP-Konfiguration den Versand', async () => {
    const log = fakeLog();
    await expect(createMailSender({ NODE_ENV: 'production' }, log)(msg)).rejects.toThrow(/SMTP_HOST/);
    expect(log.info).not.toHaveBeenCalled();
  });

  it('erlaubt den Log-Modus in Produktion nur ausdrücklich', async () => {
    const log = fakeLog();
    await createMailSender({ NODE_ENV: 'production', MAIL_TRANSPORT: 'log' }, log)(msg);
    expect(log.info).toHaveBeenCalledOnce();
  });

  it('prüft die SMTP-Konfiguration', () => {
    expect(() => createMailSender({ MAIL_TRANSPORT: 'smtp' })).toThrow(/SMTP_HOST/);
    expect(() => createMailSender({ SMTP_HOST: 'localhost' })).toThrow(/MAIL_FROM/);
    expect(createMailSender({ SMTP_HOST: 'localhost', MAIL_FROM: 'x@example.org' })).toBeTypeOf('function');
    expect(() => createMailSender({ MAIL_TRANSPORT: 'carrier-pigeon' })).toThrow(/MAIL_TRANSPORT/);
  });
});

describe('sendLoginCodeEmail', () => {
  it('übergibt Empfänger und Template an den Versandweg', async () => {
    const sent: MailMessage[] = [];
    setMailSender(async (m) => void sent.push(m));
    await sendLoginCodeEmail('b@example.org', '987654');
    expect(sent).toEqual([{ to: 'b@example.org', ...loginCodeEmail('987654') }]);
  });

  it('loggt Versandfehler ohne den Code und wirft weiter', async () => {
    const log = fakeLog();
    setMailSender(async () => {
      throw new Error('Verbindung abgelehnt');
    }, log);
    await expect(sendLoginCodeEmail('c@example.org', '111222')).rejects.toThrow('Verbindung abgelehnt');
    expect(log.error).toHaveBeenCalledOnce();
    const line = log.error.mock.calls[0][0] as string;
    expect(line).toContain('c@example.org');
    expect(line).toContain('Verbindung abgelehnt');
    expect(line).not.toContain('111222');
  });
});
