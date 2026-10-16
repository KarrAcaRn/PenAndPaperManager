import { STORAGE_PROVIDER_LABELS, type StorageConfig, type StorageProviderInfo, type StorageProviderType } from '@pnp/shared';
import { badRequest } from '../errors.ts';
import { googleDriveOptionsFromEnv, googleDriveProvider } from './googleDrive.ts';
import type { StorageProviderDefinition } from './provider.ts';
import { s3Provider } from './s3.ts';

/** Liefert zu einem providerType die Implementierung. */
export class StorageProviderRegistry {
  // any: die Registry kennt die Config-/Credential-Typen der einzelnen Anbieter nicht
  readonly #definitions = new Map<StorageProviderType, StorageProviderDefinition<any, any>>();

  register<C extends StorageConfig, S>(definition: StorageProviderDefinition<C, S>): this {
    if (this.#definitions.has(definition.type)) throw new Error(`Anbieter ${definition.type} ist schon eingetragen`);
    this.#definitions.set(definition.type, definition);
    return this;
  }

  has(type: StorageProviderType): boolean {
    return this.#definitions.has(type);
  }

  get(type: StorageProviderType): StorageProviderDefinition<any, any> {
    const definition = this.#definitions.get(type);
    if (!definition) throw badRequest(`Speicher-Anbieter "${STORAGE_PROVIDER_LABELS[type] ?? type}" ist auf diesem Server nicht verfügbar`);
    return definition;
  }

  list(): StorageProviderInfo[] {
    return [...this.#definitions.values()].map((d) => ({
      type: d.type,
      label: STORAGE_PROVIDER_LABELS[d.type],
      manualSetup: d.parseInput !== undefined,
    }));
  }
}

/**
 * Die Anbieter dieses Servers. S3 ist immer verfügbar; `S3_ALLOW_PRIVATE_ENDPOINTS=1` erlaubt S3-Endpoints im lokalen
 * Netz (selbst gehostetes MinIO). Google Drive ist nur verfügbar, wenn GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET und
 * GOOGLE_REDIRECT_URI gesetzt sind (sonst böte die Oberfläche einen Anbieter an, dessen Anmeldung scheitert).
 */
export function defaultStorageProviders(env: NodeJS.ProcessEnv = process.env): StorageProviderRegistry {
  const registry = new StorageProviderRegistry().register(s3Provider({ allowPrivateEndpoints: env.S3_ALLOW_PRIVATE_ENDPOINTS === '1' }));
  const drive = googleDriveOptionsFromEnv(env);
  if (drive) registry.register(googleDriveProvider(drive));
  return registry;
}
