import { DEFAULT_PRESET_NAME, type SkillPresetInput } from '@pnp/shared';

/**
 * Default-Varianten, mit denen eine neue Installation startet. Danach pflegt sie der Admin-Bereich;
 * Änderungen hier wirken nur auf frische Datenbanken.
 *
 * Die Listen stammen aus den Charakterbögen und frei verfügbaren Regelwerken von https://faterpg.de/downloads/
 * (Stand 2026-09). Spiele, deren Bogen nur eine leere Pyramide hat und für die dort kein Regelwerk liegt,
 * fehlen bewusst: Barbaricum, Die geheime Welt der Katzen (Core), Tianxia, Bergungskreuzer MÖWE, Nest,
 * Faust (Core), Firefly, Das Schicksal der Nibelungen.
 */
export const DEFAULT_PRESETS: SkillPresetInput[] = [
  {
    name: 'Hausregel (8 Fertigkeiten)',
    description: 'Die kompakte Liste vom ursprünglichen Charakterbogen dieser Seite.',
    skills: ['Athletik', 'Diplomatie', 'Geschicklichkeit', 'Geschwindigkeit', 'Heimlichkeit', 'Kämpfen', 'Wahrnehmung', 'Wissen'],
  },
  {
    name: DEFAULT_PRESET_NAME,
    description: 'Fertigkeiten · Quelle: Fate-Core_Downloadversion.pdf',
    skills: ['Athletik', 'Charisma', 'Diebeskunst', 'Empathie', 'Fahren', 'Handwerk', 'Heimlichkeit', 'Kämpfen', 'Kontakte', 'Kraft', 'Nachforschung', 'Provozieren', 'Ressourcen', 'Schießen', 'Täuschung', 'Wahrnehmung', 'Wille', 'Wissen'],
  },
  {
    name: 'Turbo-Fate',
    description: 'Methoden · Quelle: Turbo_Fate_Charakterbogen_rot_interaktiv_A4.pdf · Dieselbe Liste nutzen: Die geheime Welt der Katzen (Turbo), Masters of Umdaar, Märchenkrieger, LOS!, Faust (Turbo), Star Wars (Turbo), Reineke Fate',
    skills: ['Flink', 'Kraftvoll', 'Scharfsinnig', 'Sorgfältig', 'Tollkühn', 'Tückisch'],
  },
  {
    name: 'Fate Kompakt',
    description: 'Fertigkeiten · Quelle: Fate_Kompakt_Charakterbogen.pdf',
    skills: ['Athletik', 'Bildung', 'Charisma', 'Diebeskunst', 'Empathie', 'Fahren', 'Handwerk', 'Heimlichkeit', 'Kontakte', 'Kraft', 'Kämpfen', 'Nachforschung', 'Provozieren', 'Ressourcen', 'Schießen', 'Spezialwissen', 'Täuschung', 'Wahrnehmung', 'Wille'],
  },
  {
    name: 'Fate Kompakt (Fan-Bogen Condensed)',
    description: 'Fertigkeiten · Quelle: FATE_Condensed_CS_A5_Fertigkeiten_deutsch_interaktiv.pdf',
    skills: ['Wissenschaft', 'Athletik', 'Diebeskunst', 'Kontakte', 'Handwerk', 'Täuschung', 'Fahren', 'Empathie', 'Kämpfen', 'Nachforschung', 'Wissen', 'Wahrnehmung', 'Kraft', 'Provozieren', 'Charisma', 'Ressourcen', 'Schießen', 'Heimlichkeit', 'Wille'],
  },
  {
    name: 'Dresden Files (Core-Edition)',
    description: 'Fertigkeiten · Quelle: DFRP-Skills.xlsx',
    skills: ['Athletik', 'Charisma', 'Einbruch', 'Empathie', 'Fahren', 'Schießen', 'Handwerk', 'Heimlichkeit', 'Kraft', 'Kontakte', 'Kämpfen', 'Okkultes Wissen', 'Provozieren', 'Nachforschung', 'Ressourcen', 'Täuschung', 'Wahrnehmung', 'Willenskraft', 'Wissenschaft'],
  },
  {
    name: 'Dresden Files (Classic / Fate 3)',
    description: 'Fertigkeiten · Quelle: DFRP-Skills.xlsx',
    skills: ['Wachsamkeit', 'Athletik', 'Einbruch', 'Kontakte', 'Überzeugung', 'Handwerk', 'Hinterlist', 'Disziplin', 'Fahren', 'Empathie', 'Ausdauer', 'Waffenloser Angriff', 'Schußwaffen', 'Einschüchterung', 'Untersuchung', 'Okkultes Wissen', 'Stärke', 'Darstellung', 'Präsenz', 'Beziehungen', 'Ressourcen', 'Wissenschaft', 'Heimlichkeit', 'Überleben', 'Waffen'],
  },
  {
    name: 'Malmsturm – Die Fundamente',
    description: 'Fertigkeiten · Quelle: Malmsturm_Die-Fundamente_Ebook-fuer-umme.pdf',
    skills: ['Athletik', 'Charisma', 'Diebeskunst', 'Empathie', 'Fernkampf', 'Gelehrsamkeit', 'Handwerk', 'Heimlichkeit', 'Kämpfen', 'Kontakte', 'Lenken', 'Nachforschen', 'Provozieren', 'Ressourcen', 'Statur', 'Täuschen', 'Überleben', 'Wahrnehmen', 'Wille'],
  },
  {
    name: 'Eagle Eyes',
    description: 'Methoden · Quelle: EagleEyes-Charakterbogen-A4.pdf',
    skills: ['Juno (Sorgfältig)', 'Minerva (Scharfsinnig)', 'Jupiter (Tollkühn)', 'Mars (Kraftvoll)', 'Merkur (Flink)', 'Pluto (Tückisch)'],
  },
  {
    name: 'Fate of Cthulhu',
    description: 'Fertigkeiten · Quelle: Fate-of-Cthulhu_Charakterbogen.pdf',
    skills: ['Athletik', 'Bildung', 'Charisma', 'Diebeskunst', 'Empathie', 'Fahren', 'Handwerk', 'Heimlichkeit', 'Kämpfen', 'Kontakte', 'Kraft', 'Mythoswissen', 'Nachforschung', 'Provozieren', 'Ressourcen', 'Schießen', 'Täuschen', 'Wahrnehmung', 'Wille'],
  },
  {
    name: 'Fate of Cthulhu (Turbo)',
    description: 'Methoden · Quelle: Fate-of-Cthulhu-Turbo_Charakterbogen.pdf',
    skills: ['Brutal', 'Draufgängerisch', 'Vorsichtig', 'Clever', 'Verstohlen', 'Schnell'],
  },
  {
    name: 'Wearing the Cape',
    description: 'Fertigkeiten · Quelle: WtC-Spielhilfe-2-Charaktererschaffung.pdf',
    skills: ['Akademisches Wissen', 'Heilkunde', 'Täuschen', 'Fahren', 'Technik', 'Kämpfen', 'Nachforschung', 'Verbrechen', 'Provozieren', 'Charisma', 'Schießen', 'Heimlichkeit', 'Überleben'],
  },
  {
    name: 'Wearing the Cape (Attribute, Fertigkeiten, Ressourcen)',
    description: 'Fertigkeiten · Quelle: WtC-Spielhilfe-2-Charaktererschaffung.pdf',
    skills: ['Wahrnehmung', 'Athletik', 'Stärke', 'Urteilsvermögen', 'Willenskraft', 'Präsenz', 'Akademisches Wissen', 'Heilkunde', 'Täuschen', 'Fahren', 'Technik', 'Kämpfen', 'Nachforschung', 'Verbrechen', 'Provozieren', 'Charisma', 'Schießen', 'Heimlichkeit', 'Überleben', 'Kontakte', 'Reputation', 'Vermögen'],
  },
  {
    name: 'Opus Magnum',
    description: 'Fertigkeiten · Quelle: OpusMagnum-Charakterbogen.pdf',
    skills: ['Künstliches Leben', 'Manifestation', 'Orakel', 'Transformation', 'Seele'],
  },
  {
    name: 'Käpt\'n Blaubär',
    description: 'Methoden · Quelle: Kaeptn-Blaubaer_Charakterblatt.pdf · Dieselbe Liste nutzen: Kinderserien',
    skills: ['allein', 'mit Anderen', 'gegen Andere'],
  },
  {
    name: 'Avatar (Turbo)',
    description: 'Methoden · Quelle: Turbo-Avatar-Charakterbogen.pdf',
    skills: ['Wasser', 'Erde', 'Feuer', 'Luft'],
  },
];
