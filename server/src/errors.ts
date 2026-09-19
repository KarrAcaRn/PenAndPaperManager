export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, 'Nicht eingeloggt');
export const forbidden = (msg = 'Keine Berechtigung') => new HttpError(403, msg);
export const gmOnly = () => forbidden('Nur für Spielleiter');
export const notFound = (msg = 'Nicht gefunden') => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);
export const badRequest = (msg: string) => new HttpError(400, msg);
