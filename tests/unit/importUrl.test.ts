/**
 * Detection des domaines qui bloquent le telechargement direct.
 *
 * Cette liste ne protege de rien: elle sert a produire un message UTILE. Sans
 * elle, coller un lien Instagram donnerait un echec reseau opaque, et
 * l'utilisateur conclurait que l'application est cassee — alors que c'est une
 * limite du navigateur (CORS) qu'aucun code cote client ne contourne.
 */

import { describe, expect, it } from 'vitest';

import { isBlockedMediaHost } from '@/features/import/importUrl';

describe('isBlockedMediaHost', () => {
  it('reconnait les reseaux sociaux qui refusent l acces direct', () => {
    const blocked = [
      'https://www.instagram.com/reel/ABC123/',
      'https://instagram.com/p/xyz',
      'https://scontent.cdninstagram.com/v/file.mp4',
      'https://www.tiktok.com/@user/video/123',
      'https://youtu.be/abcdef',
      'https://www.youtube.com/watch?v=abcdef',
      'https://x.com/user/status/1',
      'https://fb.watch/abc',
    ];
    for (const url of blocked) {
      expect(isBlockedMediaHost(url), url).toBe(true);
    }
  });

  it('laisse passer un lien direct vers un fichier', () => {
    const allowed = [
      'https://example.com/clip.mp4',
      'https://cdn.example.org/audio/loop.mp3',
      'https://media.mon-site.fr/photo.jpg',
    ];
    for (const url of allowed) {
      expect(isBlockedMediaHost(url), url).toBe(false);
    }
  });

  it('ne se fait pas tromper par un domaine qui contient le nom', () => {
    // `instagram.com.attaquant.net` n'est PAS instagram.com: la verification doit
    // porter sur les frontieres de sous-domaine, pas sur une sous-chaine.
    expect(isBlockedMediaHost('https://instagram.com.exemple.net/x.mp4')).toBe(false);
    expect(isBlockedMediaHost('https://faketiktok.com/x.mp4')).toBe(false);
    // Un vrai sous-domaine, en revanche, doit etre reconnu.
    expect(isBlockedMediaHost('https://cdn.instagram.com/x.mp4')).toBe(true);
  });

  it('renvoie faux sur une adresse invalide', () => {
    // La validation du format est du ressort de `importFromUrl`; ici on ne doit
    // simplement pas lever.
    expect(isBlockedMediaHost('pas une url')).toBe(false);
    expect(isBlockedMediaHost('')).toBe(false);
  });

  it('ignore la casse du nom d hote', () => {
    expect(isBlockedMediaHost('https://WWW.Instagram.COM/reel/x')).toBe(true);
  });
});
