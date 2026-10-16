import { describe, expect, it } from 'vitest';
import { AUDIO_EXTENSIONS, audioExtension } from '../src/index.ts';

describe('audioExtension', () => {
  it('erkennt erlaubte Audio-Endungen unabhängig von Groß-/Kleinschreibung', () => {
    expect(AUDIO_EXTENSIONS).toEqual(['mp3', 'wav', 'ogg', 'm4a']);
    expect(audioExtension('musik/Thema.MP3')).toBe('mp3');
    expect(audioExtension('a.b.ogg')).toBe('ogg');
    expect(audioExtension('glocke.m4a')).toBe('m4a');
  });

  it('lehnt andere und fehlende Endungen ab', () => {
    for (const name of ['sounds.json', 'wav', 'ordner.wav/datei', '.wav/x', 'x/.wav', '.mp3', 'x.', 'x.toString', 'x.constructor']) {
      expect(audioExtension(name), name).toBeNull();
    }
  });
});
