-- Benutzereinstellungen: „theme“ war bisher das Farbschema (system/light/dark). Es heißt jetzt „colorScheme“,
-- „theme“ ist die ID des gewählten Themes (siehe shared/src/settings.ts).
-- Rückbau (verliert eine inzwischen gespeicherte Theme-ID, die durch das Farbschema ersetzt wird):
--   UPDATE user_settings SET data = json_remove(json_set(data, '$.theme', json_extract(data, '$.colorScheme')), '$.colorScheme');
UPDATE user_settings
SET data = json_remove(json_set(data, '$.colorScheme', json_extract(data, '$.theme')), '$.theme')
WHERE json_extract(data, '$.theme') IN ('system', 'light', 'dark');
