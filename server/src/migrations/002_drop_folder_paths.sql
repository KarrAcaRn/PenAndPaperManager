-- Ordnerpfade setzt der Server jetzt aus parent_id zusammen (server/src/folders.ts): das rekursive View lief bei
-- jeder Abfrage über die Ordner aller Gruppen.
DROP VIEW folder_paths;
