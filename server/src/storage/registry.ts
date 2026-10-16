import { STORAGE_PROVIDER_LABELS, type StorageConfig, type StorageProviderInfo, type StorageProviderType } from '@pnp/shared';
import { badRequest } from '../errors.ts';
import type { StorageProviderDefinition } from './provider.ts';

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
 * Die Anbieter dieses Servers. S3 und Google Drive werden hier eingetragen, sobald ihre Adapter existieren
 * (z.B. `registry.register(s3Provider)`); bis dahin ist die Liste leer.
 */
export function defaultStorageProviders(): StorageProviderRegistry {
  return new StorageProviderRegistry();
}
