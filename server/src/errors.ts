export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = (msg = 'Nicht eingeloggt') => new HttpError(401, msg);
export const forbidden = (msg = 'Keine Berechtigung') => new HttpError(403, msg);
export const gmOnly = () => forbidden('Nur für Spielleiter');
export const adminOnly = () => forbidden('Nur für Administratoren');
export const notFound = (msg = 'Nicht gefunden') => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);
export const badRequest = (msg: string) => new HttpError(400, msg);
export const tooManyRequests = (msg = 'Zu viele Anfragen, bitte später erneut versuchen') => new HttpError(429, msg);
