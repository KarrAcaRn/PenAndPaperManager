import type { FastifyInstance } from 'fastify';
import { MAX_PATH_LENGTH, isWithin, pathPrefixes, type Folder, type Section } from '@pnp/shared';
import { allRows, getRow, run, transaction, type Db } from '../db.ts';
import { assertSection, requireMember, type MemberContext } from '../auth.ts';
import { VISIBLE_ARTICLE_SQL, canManageFolder, visibilityParams } from '../access.ts';
import { IN_SECTION_SQL, ensureFolders, parseFolderPath, withinSql } from '../folders.ts';
import { badRequest, conflict, forbidden, notFound } from '../errors.ts';
import { gidParams, objectOf, sectionProp } from '../schemas.ts';

const location = { section: sectionProp, path: { type: 'string', minLength: 1 } };

export function folderRoutes(app: FastifyInstance, db: Db): void {
  /** Explizite Ordner plus alle Pfad-Präfixe der für den Anfragenden sichtbaren Artikel. */
  const listFolders = (ctx: MemberContext, section: Section): Folder[] => {
    const inSection = { gid: ctx.groupId, section };
    const folders = new Map<string, Folder>();
    const add = (path: string, explicit: boolean, createdBy: number | null) =>
      folders.set(path, { path, explicit, canManage: canManageFolder(ctx.user.id, ctx.role, { createdBy }) });

    const explicit = allRows<{ path: string; createdBy: number }>(
      db,
      `SELECT path, created_by AS createdBy FROM folders WHERE ${IN_SECTION_SQL}`,
      inSection,
    );
    for (const f of explicit) add(f.path, true, f.createdBy);

    const articlePaths = allRows<{ path: string }>(
      db,
      `SELECT DISTINCT a.path FROM articles a
       WHERE a.group_id = :gid AND a.section = :section AND a.path <> '' AND ${VISIBLE_ARTICLE_SQL}`,
      { ...inSection, ...visibilityParams(ctx.user.id, ctx.role) },
    );
    for (const row of articlePaths) {
      for (const path of pathPrefixes(row.path)) {
        if (!folders.has(path)) add(path, false, null);
      }
    }
    return [...folders.values()].sort((a, b) => a.path.localeCompare(b.path, 'de'));
  };

  /** Unsichtbare Ordner gibt es für den Anfragenden nicht (404), fremde darf er nicht ändern (403). */
  const requireManageable = (visible: Folder[], path: string): Folder => {
    const folder = visible.find((f) => f.path === path);
    if (!folder) throw notFound('Ordner nicht gefunden');
    if (!folder.canManage) throw forbidden('Nur der Ersteller oder ein Spielleiter darf diesen Ordner ändern');
    return folder;
  };

  const managedFolder = (path: string): Folder => ({ path, explicit: true, canManage: true });

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
    transaction(db, () => ensureFolders(db, ctx.groupId, body.section, path, ctx.user.id));
    reply.code(201);
    return managedFolder(path);
  });

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
      const explicit = transaction(db, () => {
        const visible = listFolders(ctx, body.section);
        const source = requireManageable(visible, path);
        // Ein für den Anfragenden unsichtbarer Zielordner wird bewusst nicht gemeldet (das würde ihn
        // verraten) - die Inhalte landen dann im selben Ordner.
        if (visible.some((f) => f.path === newPath)) throw conflict('Es gibt bereits einen Ordner mit diesem Namen');

        const inSection = { gid: ctx.groupId, section: body.section };
        const longest = getRow<{ n: number | null }>(
          db,
          `SELECT MAX(n) AS n FROM (
             SELECT MAX(length(path)) AS n FROM folders WHERE ${IN_SECTION_SQL} AND ${withinSql('path')}
             UNION ALL
             SELECT MAX(length(path)) FROM articles WHERE ${IN_SECTION_SQL} AND ${withinSql('path')})`,
          { ...inSection, path },
        )!.n;
        if ((longest ?? path.length) - path.length + newPath.length > MAX_PATH_LENGTH) {
          throw badRequest(`Pfade im Ordner würden zu lang (max. ${MAX_PATH_LENGTH} Zeichen)`);
        }
        // Zieht Unterordner und alle Artikel (auch für den Anfragenden unsichtbare) mit um.
        for (const table of ['folders', 'articles']) {
          run(
            db,
            `UPDATE ${table} SET path = :newPath || substr(path, length(:path) + 1)
             WHERE ${IN_SECTION_SQL} AND ${withinSql('path')}`,
            { ...inSection, path, newPath },
          );
        }
        // Nur aus Artikelpfaden entstandene Ordner bleiben implizit, sonst würde ihr Name für alle sichtbar.
        if (source.explicit) ensureFolders(db, ctx.groupId, body.section, newPath, ctx.user.id);
        return source.explicit;
      });
      return { ...managedFolder(newPath), explicit };
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
        requireManageable(listFolders(ctx, query.section), path);
        const params = { gid: ctx.groupId, section: query.section, path };
        // Zählt bewusst auch Artikel, die der Anfragende nicht sehen kann.
        const hasArticles = getRow(db, `SELECT 1 FROM articles WHERE ${IN_SECTION_SQL} AND ${withinSql('path')} LIMIT 1`, params);
        const hasSubfolders = getRow(
          db,
          `SELECT 1 FROM folders WHERE ${IN_SECTION_SQL} AND path <> :path AND ${withinSql('path')} LIMIT 1`,
          params,
        );
        if (hasArticles || hasSubfolders) {
          throw conflict('Ordner ist nicht leer (er kann auch Artikel enthalten, die du nicht sehen kannst)');
        }
        run(db, `DELETE FROM folders WHERE ${IN_SECTION_SQL} AND path = :path`, params);
      });
      return { ok: true };
    },
  );
}
