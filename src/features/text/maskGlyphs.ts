/**
 * Bibliotheque de formes pour les masques de texte. Module PUR.
 *
 * POURQUOI une liste fermee plutot que le clavier emoji du systeme: mesure sur
 * le selecteur de Windows, la majorite de ce qu'il propose est inutilisable ici
 * — marques combinantes qui s'affichent en cercle pointille, caracteres de
 * controle, et surtout des glyphes absents des polices installees, qui sortent
 * en carre « tofu ». Un masque decoupe une SILHOUETTE dans l'image: un carre
 * vide donne un rectangle plein, ce qui ne ressemble a rien.
 *
 * Les formes retenues repondent donc a trois criteres:
 *
 *  - presentes dans les polices de base de Windows, macOS, iOS et Android;
 *  - d'un seul tenant, sans marque combinante ni variante d'emoji;
 *  - avec une silhouette PLEINE et large, la seule qui laisse voir l'image au
 *    travers. Un trait fin ne montre presque rien et rate l'effet.
 *
 * Les emoji sont volontairement peu nombreux: la plupart sont rendus en couleur
 * par le systeme, et le compositeur les dessine alors en aplat plutot qu'en
 * decoupe. Ceux qui sont ici ont une forme franche qui tient a l'usage.
 */

/** Une categorie de formes, pour ranger la bibliotheque en onglets. */
export interface GlyphGroup {
  /** Cle i18n du titre de la categorie. */
  labelKey:
    | 'editor:mask.groups.letters'
    | 'editor:mask.groups.numbers'
    | 'editor:mask.groups.shapes'
    | 'editor:mask.groups.arrows'
    | 'editor:mask.groups.symbols'
    | 'editor:mask.groups.emoji';
  glyphs: readonly string[];
}

export const GLYPH_GROUPS: readonly GlyphGroup[] = [
  {
    labelKey: 'editor:mask.groups.letters',
    // Les capitales sont les meilleures silhouettes: pleines, larges, connues.
    glyphs: [
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
      'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    ],
  },
  {
    labelKey: 'editor:mask.groups.numbers',
    glyphs: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
  },
  {
    labelKey: 'editor:mask.groups.shapes',
    // Geometriques pleins: le bloc U+25A0..U+25FF est couvert partout.
    glyphs: ['●', '■', '▲', '▼', '◆', '★', '♥', '♦', '♣', '♠', '⬟', '⬢', '▬', '⬤'],
  },
  {
    labelKey: 'editor:mask.groups.arrows',
    glyphs: ['←', '↑', '→', '↓', '↔', '↕', '➜', '➤', '⇒', '⇔'],
  },
  {
    labelKey: 'editor:mask.groups.symbols',
    glyphs: ['?', '!', '&', '#', '@', '%', '+', '=', '§', '¶', '€', '$', '£', '©', '®', '™'],
  },
  {
    labelKey: 'editor:mask.groups.emoji',
    // Choisis pour leur silhouette compacte: un emoji filiforme ne decoupe rien.
    glyphs: ['❤', '★', '☀', '☁', '☂', '☺', '✈', '✂', '✿', '❄', '♪', '♫'],
  },
];

/**
 * Longueur conseillee du contenu d'un masque.
 *
 * Au-dela, les lettres deviennent si etroites que l'image ne se lit plus a
 * travers — l'effet s'annule de lui-meme. L'interface le dit plutot que de
 * l'interdire: rien ne casse, c'est juste moins beau.
 */
export const RECOMMENDED_MASK_LENGTH = 2;
