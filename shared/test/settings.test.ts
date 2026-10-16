import { describe, expect, it } from 'vitest';
import { DEFAULT_USER_SETTINGS, THEMES, USER_SETTING_KEYS, USER_SETTING_OPTIONS, normalizeUserSettings } from '../src/settings.ts';

describe('Benutzereinstellungen', () => {
  it('nimmt den ersten erlaubten Wert als Vorgabe', () => {
    expect(DEFAULT_USER_SETTINGS).toEqual({ theme: 'system' });
    for (const key of USER_SETTING_KEYS) expect(DEFAULT_USER_SETTINGS[key]).toBe(USER_SETTING_OPTIONS[key][0]);
    expect(USER_SETTING_OPTIONS.theme).toBe(THEMES);
  });

  it('liefert für fehlende oder kaputte Daten die Vorgaben', () => {
    for (const raw of [undefined, null, 'dark', 42, [], {}]) expect(normalizeUserSettings(raw)).toEqual(DEFAULT_USER_SETTINGS);
  });

  it('übernimmt erlaubte Werte, verwirft ungültige und unbekannte', () => {
    expect(normalizeUserSettings({ theme: 'dark' })).toEqual({ theme: 'dark' });
    expect(normalizeUserSettings({ theme: 'pink', fontSize: 3 })).toEqual({ theme: 'system' });
  });

  it('gibt nie das Vorgabe-Objekt selbst heraus', () => {
    const settings = normalizeUserSettings({});
    settings.theme = 'dark';
    expect(DEFAULT_USER_SETTINGS.theme).toBe('system');
  });
});
