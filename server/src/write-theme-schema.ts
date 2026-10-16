/** Schreibt das JSON-Schema des Theme-Manifests nach themes/theme.schema.json (npm run theme:schema -w server) */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { themeManifestSchema } from '@pnp/shared';
import { builtinThemesDir } from './paths.ts';

export const themeSchemaFile = () => join(builtinThemesDir(), 'theme.schema.json');
export const themeSchemaJson = () => JSON.stringify(themeManifestSchema(), null, 2) + '\n';

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  writeFileSync(themeSchemaFile(), themeSchemaJson());
  console.log(`Geschrieben: ${themeSchemaFile()}`);
}
