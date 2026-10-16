import type { UploadTarget } from '@pnp/shared';

// Direkter Upload vom Browser zum Speicher-Anbieter (presigned PUT/POST bzw. Drive-Resumable-Session).
// Bewusst XMLHttpRequest statt fetch: nur damit gibt es eine Fortschrittsanzeige für den Upload.
// Die Datei geht nie über unseren Server, nur die URL dafür kommt von ihm.

export type UploadErrorKind = 'expired' | 'blocked' | 'offline' | 'aborted' | 'failed';

export class UploadError extends Error {
  constructor(
    public kind: UploadErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface UploadOptions {
  /** Anteil 0…1 */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** für Tests austauschbar */
  createXhr?: () => XMLHttpRequest;
  /** für Tests austauschbar */
  isOnline?: () => boolean;
}

/** Schickt die Datei an das Ziel, das der Server für diesen Upload ausgestellt hat. */
export function uploadDirect(target: UploadTarget, file: Blob, contentType: string, options: UploadOptions = {}): Promise<void> {
  const xhr = (options.createXhr ?? (() => new XMLHttpRequest()))();
  const online = options.isOnline ?? (() => navigator.onLine);
  return new Promise<void>((resolve, reject) => {
    if (options.signal?.aborted) return reject(new UploadError('aborted', 'Upload abgebrochen'));
    xhr.open(target.method, target.url);
    let body: Blob | FormData = file;
    if (target.method === 'PUT') {
      const headers = { ...target.headers };
      if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = contentType;
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    } else {
      // presigned POST: alle Felder der Signatur zuerst, die Datei als letztes Feld „file“
      const form = new FormData();
      for (const [name, value] of Object.entries(target.fields)) form.append(name, value);
      form.append('file', file);
      body = form;
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) options.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(1);
        return resolve();
      }
      if (xhr.status === 401 || xhr.status === 403) {
        return reject(new UploadError('expired', 'Der Anbieter hat den Upload abgelehnt: Der Upload-Link ist abgelaufen oder die Rechte fehlen.'));
      }
      reject(new UploadError('failed', `Der Anbieter hat den Upload abgelehnt (HTTP ${xhr.status}).`));
    };
    // Ohne Antwort (Status 0) verrät der Browser nicht, warum – entweder ist die Verbindung weg, oder der
    // Anbieter erlaubt Anfragen von dieser Seite nicht (CORS).
    xhr.onerror = () =>
      reject(
        online()
          ? new UploadError(
              'blocked',
              'Der Anbieter hat den Upload blockiert. Meist fehlt die CORS-Freigabe für diese Seite im Bucket bzw. Speicher (siehe Kontoeinstellungen) – oder die Verbindung ist abgebrochen.',
            )
          : new UploadError('offline', 'Keine Internetverbindung – der Upload wurde unterbrochen.'),
      );
    xhr.ontimeout = () => reject(new UploadError('offline', 'Zeitüberschreitung – die Verbindung zum Anbieter ist abgebrochen.'));
    xhr.onabort = () => reject(new UploadError('aborted', 'Upload abgebrochen'));
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}
