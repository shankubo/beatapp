/**
 * Erreur de programmation (invariant viole), a distinguer des erreurs
 * utilisateur qui, elles, doivent etre traduites et affichees.
 */
export class InvariantError extends Error {
  constructor(message: string) {
    super(`Invariant viole: ${message}`);
    this.name = 'InvariantError';
  }
}

/**
 * Verifie un invariant du domaine. Ces messages ne sont JAMAIS montres a
 * l'utilisateur (donc non traduits) : ils signalent un bug, pas une action
 * invalide de l'utilisateur.
 */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InvariantError(message);
}

export function assertNever(value: never, context: string): never {
  throw new InvariantError(`Cas non gere dans ${context}: ${JSON.stringify(value)}`);
}

/** Acces indexe sur/verifie, requis par `noUncheckedIndexedAccess`. */
export function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  invariant(value !== undefined, `index ${index} hors bornes (taille ${items.length})`);
  return value;
}
