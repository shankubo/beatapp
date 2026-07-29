/**
 * Constantes injectees a la compilation par `define` dans `vite.config.ts`.
 *
 * Declarees ici pour que le typage les connaisse: sans cela, `__APP_VERSION__`
 * serait une erreur de compilation alors que Vite la remplace bel et bien.
 */

/** Version issue de `package.json`, affichee par l'ecran « A propos ». */
declare const __APP_VERSION__: string;
