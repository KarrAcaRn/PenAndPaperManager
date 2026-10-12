import type { FastifyInstance } from 'fastify';
import { MAX_PATH_LENGTH, baseName, isWithin, parentPath, type Folder, type Section } from '@pnp/shared';
import { allRows, getRow, run, transaction, type Db } from '../db.ts';
import { assertSection, requireMember, type MemberContext } from '../auth.ts';
import { canManageFolder } from '../access.ts';
import { FOLDERS_WITH_PATH, ensureFolderPath, findFolderId, parseFolderPath } from '../folders.ts';
import { badRequest, conflict, forbidden, notFound } from '../errors.ts';
import { gidParams, objectOf, sectionProp } from '../schemas.ts';

const location = { section: sectionProp, path: { type: 'string', minLength: 1 } };

/**
 * Ordner sieht jeder, der den Bereich sieht (der Spielleiter-Bereich ist für Spieler ohnehin gesperrt).
 * Ein- und ausgeblendet werden nur die Artikel darin.
 */
export function folderRoutes(app: FastifyInstance, db: Db): void {
  const listFolders = (ctx: MemberContext, section: Section): Folder[] =>
    allRows<{ path: string; createdBy: number }>(
      db,
      `SELECT fp.path, f.created_by AS createdBy FROM ${FOLDERS_WITH_PATH} WHERE f.group_id = ? AND f.section = ?`,
      ctx.groupId,
      section,
    )
      .map(({ path, createdBy }) => ({ path, canManage: canManageFolder(ctx.user.id, ctx.role, { createdBy }) }))
      .sort((a, b) => a.path.localeCompare(b.path, 'de'));

  /** Ordner, den der Anfragende ändern darf: 404 wenn es ihn nicht gibt, 403 wenn er fremd ist. */
  const requireManageable = (ctx: MemberContext, section: Section, path: string): number => {
    const id = findFolderId(db, ctx.groupId, section, path);
    if (id == null) throw notFound('Ordner nicht gefunden');
    const { createdBy } = getRow<{ createdBy: number }>(db, 'SELECT created_by AS createdBy FROM folders WHERE id = ?', id)!;
    if (!canManageFolder(ctx.user.id, ctx.role, { createdBy })) {
      throw forbidden('Nur der Ersteller oder ein Spielleiter darf diesen Ordner ändern');
    }
    return id;
  };

  const managedFolder = (path: string): Folder => ({ path, canManage: true });

  app.get(
    '/api/groups/:gid/folders',
    { schema: { params: gidParams, querystring: objectOf({ section: sectionProp }) } },
    (req) => {
      const ctx = requireMember(db, req);
      const { section } = req.query as { section: Section };
      assertSection(ctx, section);
      return listFolders(ctx, section);
    },
  );

  app.post('/api/groups/:gid/folders', { schema: { params: gidParams, body: objectOf(location) } }, (req, reply) => {
    const ctx = requireMember(db, req);
    const body = req.body as { section: Section; path: string };
    assertSection(ctx, body.section);
    const path = parseFolderPath(body.path);
    const id = transaction(db, () => ensureFolderPath(db, ctx.groupId, body.section, path, ctx.user.id))!;
    // Gab es den Ordner schon, gehört er womöglich jemand anderem
    const { createdBy } = getRow<{ createdBy: number }>(db, 'SELECT created_by AS createdBy FROM folders WHERE id = ?', id)!;
    reply.code(201);
    return { path, canManage: canManageFolder(ctx.user.id, ctx.role, { createdBy }) } satisfies Folder;
  });

  // Umbenennen und Verschieben: nur die Zeile des Ordners ändert sich, Inhalt hängt an seiner ID.
  app.patch(
    '/api/groups/:gid/folders',
    { schema: { params: gidParams, body: objectOf({ ...location, newPath: { type: 'string', minLength: 1 } }) } },
    (req) => {
      const ctx = requireMember(db, req);
      const body = req.body as { section: Section; path: string; newPath: string };
      assertSection(ctx, body.section);
      const path = parseFolderPath(body.path);
      const newPath = parseFolderPath(body.newPath);
      if (isWithin(newPath, path)) throw badRequest('Ein Ordner kann nicht in sich selbst verschoben werden');
      transaction(db, () => {
        const id = requireManageable(ctx, body.section, path);
        if (findFolderId(db, ctx.groupId, body.section, newPath) !== undefined) {
          throw conflict('Es gibt bereits einen Ordner mit diesem Namen');
        }
        // Längen in JS messen: SQLite zählt Codepoints, normalizePath aber UTF-16-Einheiten (Emoji!).
        const inside = allRows<{ path: string }>(
          db,
          `SELECT fp.path FROM ${FOLDERS_WITH_PATH} WHERE f.group_id = ? AND f.section = ?`,
          ctx.groupId,
          body.section,
        ).filter((f) => isWithin(f.path, path));
        if (inside.some((f) => f.path.length - path.length + newPath.length > MAX_PATH_LENGTH)) {
          throw badRequest(`Pfade im Ordner würden zu lang (max. ${MAX_PATH_LENGTH} Zeichen)`);
        }
        const parentId = ensureFolderPath(db, ctx.groupId, body.section, parentPath(newPath), ctx.user.id);
        run(db, 'UPDATE folders SET parent_id = ?, name = ? WHERE id = ?', parentId, baseName(newPath), id);
      });
      return managedFolder(newPath);
    },
  );

  app.delete(
    '/api/groups/:gid/folders',
    { schema: { params: gidParams, querystring: objectOf(location) } },
    (req) => {
      const ctx = requireMember(db, req);
      const query = req.query as { section: Section; path: string };
      assertSection(ctx, query.section);
      const path = parseFolderPath(query.path);
      transaction(db, () => {
        const id = requireManageable(ctx, query.section, path);
        // Zählt bewusst auch Artikel, die der Anfragende nicht sehen kann.
        const hasArticles = getRow(db, 'SELECT 1 FROM articles WHERE folder_id = ? LIMIT 1', id);
        const hasSubfolders = getRow(db, 'SELECT 1 FROM folders WHERE parent_id = ? LIMIT 1', id);
        if (hasArticles || hasSubfolders) {
          throw conflict('Ordner ist nicht leer (er kann auch Artikel enthalten, die du nicht sehen kannst)');
        }
        run(db, 'DELETE FROM folders WHERE id = ?', id);
      });
      return { ok: true };
    },
  );
}
