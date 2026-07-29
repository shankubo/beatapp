import type { frResources } from './index';
import type { DEFAULT_NS } from './index';

/**
 * Augmentation de module: rend `t()` completement type.
 * `t('editor:timeline.nope')` devient une erreur de COMPILATION, pas un bug
 * silencieux decouvert en production. C'est le second garde-fou i18n, apres
 * la regle eslint `i18next/no-literal-string`.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof DEFAULT_NS;
    resources: typeof frResources;
    returnNull: false;
  }
}
