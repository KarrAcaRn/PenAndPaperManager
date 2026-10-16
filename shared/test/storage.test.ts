import { describe, expect, it } from 'vitest';
import { audioExtension, isAudioFile, isAudioMimeType, uploadMatchesAudio } from '../src/index.ts';

describe('Audiodateien für externe Speicher', () => {
  it('erkennt die erlaubten Endungen unabhängig von Groß-/Kleinschreibung', () => {
    expect(audioExtension('Kampf.MP3')).toBe('mp3');
    expect(audioExtension('regen.wav')).toBe('wav');
    expect(audioExtension('a.b.ogg')).toBe('ogg');
    expect(audioExtension('stimme.m4a')).toBe('m4a');
    expect(audioExtension('bild.png')).toBeNull();
    expect(audioExtension('mp3')).toBeNull();
    expect(audioExtension('ordner.mp3/datei')).toBeNull();
  });

  it('erkennt Audio-Content-Types samt Parametern', () => {
    expect(isAudioMimeType('audio/mpeg')).toBe(true);
    expect(isAudioMimeType('Audio/OGG; codecs=opus')).toBe(true);
    expect(isAudioMimeType('video/mp4')).toBe(false);
  });

  it('lässt Dateien per Endung oder Content-Type als Audio gelten', () => {
    expect(isAudioFile({ name: 'x.mp3', mimeType: null })).toBe(true);
    expect(isAudioFile({ name: 'ohne Endung', mimeType: 'audio/wav' })).toBe(true);
    expect(isAudioFile({ name: 'notiz.txt', mimeType: 'text/plain' })).toBe(false);
  });

  it('verlangt beim Upload, dass Endung und Content-Type zusammenpassen', () => {
    expect(uploadMatchesAudio('x.mp3', 'audio/mpeg')).toBe(true);
    expect(uploadMatchesAudio('x.m4a', 'audio/x-m4a')).toBe(true);
    expect(uploadMatchesAudio('x.mp3', 'audio/ogg')).toBe(false);
    expect(uploadMatchesAudio('x.exe', 'audio/mpeg')).toBe(false);
    expect(uploadMatchesAudio('x.mp3', 'application/octet-stream')).toBe(false);
  });
});
