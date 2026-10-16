import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { BuiltinSoundList } from '@pnp/shared';
import { BUILTIN_SOUND_PREFIX, type SoundLibrary } from '../sounds.ts';

/** Audio-Dateien ändern sich selten; nach einem Austausch unter gleichem Namen spätestens nach einem Tag neu */
const SOUND_MAX_AGE = '1d';

export function soundRoutes(app: FastifyInstance, library: SoundLibrary, dir: string): void {
  // Ohne Login: die Standardbibliothek ist für alle da und enthält nichts Persönliches.
  app.get('/api/sounds/builtin', (_req, reply): BuiltinSoundList => {
    reply.header('cache-control', 'no-cache');
    return { sounds: library.list() };
  });

  // Dateien statisch ausliefern, nur lesend und nur, was im Manifest steht (das Manifest selbst gibt es über die API).
  // Liegen sie auf einem CDN (SOUNDS_BASE_URL), wird diese Route einfach nicht mehr angefragt.
  app.register(fastifyStatic, {
    root: dir,
    prefix: BUILTIN_SOUND_PREFIX,
    decorateReply: false,
    index: false,
    dotfiles: 'deny',
    maxAge: SOUND_MAX_AGE,
    allowedPath: (pathName) => library.hasFile(pathName.replace(/^\/+/, '')),
  });
}
