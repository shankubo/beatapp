/** Identifiants opaques, uniquement locaux (aucun serveur). */
export function newId(prefix = ''): string {
  const uuid =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : // Repli pour les contextes non securises (dev sur IP LAN sans HTTPS).
        Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
  return prefix ? `${prefix}_${uuid}` : uuid;
}
