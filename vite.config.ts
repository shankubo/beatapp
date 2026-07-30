import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

import pkg from './package.json' with { type: 'json' };

/*
  Chemin sous lequel l'application est servie.

  Vaut `/` en developpement et pour un hebergement a la racine; le deploiement
  sur https://app.francotamouls.com/beatapp/ le surcharge via BASE_PATH.

  Il ne suffit PAS de configurer nginx: `base` prefixe les URL des assets dans
  l'index, et `start_url`/`scope` decident du perimetre du service worker. Un
  manifeste reste a `/` sous un sous-chemin rend la PWA non installable et fait
  servir au SW des fichiers hors de sa portee.

  Toujours termine par une barre oblique: Vite concatene sans en ajouter, et
  `/beatapp` produirait des URL comme `/beatappassets/index.js`.
*/
const BASE = process.env.BASE_PATH ?? '/';
const BASE_PATH = BASE.endsWith('/') ? BASE : `${BASE}/`;

export default defineConfig({
  base: BASE_PATH,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // `autoUpdate` plutot que `prompt`: avec `prompt`, le service worker
      // continue de servir l'ancien bundle jusqu'a ce que l'utilisateur accepte
      // la mise a jour — et un utilisateur qui ne la voit pas reste bloque sur
      // une version perimee. Ici la nouvelle version prend effet au prochain
      // chargement, ce qui est le comportement attendu d'une application web.
      registerType: 'autoUpdate',
      /*
        Seules les icones REELLEMENT servies a l'execution.

        `icons/*.png` embarquait les 4,8 Mo du dossier, dont personne n'affiche
        la moitie: `logo_bg.png` (757 Ko) n'est que la source du generateur,
        `icon-1024.png` (625 Ko, en double iOS/Android) sert aux fiches des
        magasins d'applications, et `logo_text.png` (237 Ko) est l'ancien logo
        remplace depuis. Mesure: la premiere visite peignait a 1637 ms alors que
        le reseau avait tout livre en 140 ms — c'est le precache qui bloquait.
      */
      includeAssets: [],
      manifest: {
        name: 'Beatapp',
        short_name: 'Beatapp',
        // La description est localisee dans l'UI; le manifeste garde le francais (langue par defaut).
        description: 'Creez des reels rythmes pour Instagram et WhatsApp, directement sur votre telephone.',
        lang: 'fr',
        dir: 'ltr',
        // Suivent la base: sous un sous-chemin, un `start_url` a la racine
        // ouvrirait le mauvais site depuis l'icone d'accueil.
        start_url: BASE_PATH,
        scope: BASE_PATH,
        id: BASE_PATH,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#09090b',
        theme_color: '#09090b',
        categories: ['photo', 'video', 'entertainment'],
        icons: [
          { src: 'icons/icon-192.png',         sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png',         sizes: '512x512', type: 'image/png' },
          // Tailles supplementaires pour une meilleure couverture Android / Chrome
          { src: 'icons/generated/web/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/generated/web/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icons/generated/web/pwa-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}', 'icons/icon-*.png', 'steps/*.webp'],
        // Les PNG ne sont PLUS pris en masse: le motif generique ramassait
        // `icons/generated/` — les jeux d'icones iOS, Android et Windows
        // produits pour les magasins d'applications, jamais demandes par le
        // navigateur. Seules restent `icon-*.png`, les trois icones du
        // manifeste (192, 512, maskable-512).
        //
        // Les vignettes `steps/*.webp` restent precachees: elles s'affichent
        // sur le premier ecran et pesent 211 Ko a elles toutes.
        // Les medias utilisateur vivent dans IndexedDB/OPFS, jamais dans le cache Workbox.
        // Les samples audio sont volumineux et charges a la demande: on les exclut du precache.
        globIgnores: ['**/samples/audio/**', '**/icons/generated/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Prefixe par la base: un repli sur `/index.html` servirait la racine du
        // domaine, qui n'appartient pas a l'application sous un sous-chemin.
        navigateFallback: `${BASE_PATH}index.html`,
        // Le nouveau service worker remplace l'ancien sans attendre la
        // fermeture de tous les onglets: sinon une mise a jour peut rester en
        // attente indefiniment.
        skipWaiting: true,
        clientsClaim: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  /*
    Version injectee depuis `package.json` a la compilation.

    L'ecran « A propos » l'affiche. La recopier en dur dans le composant la
    laisserait deriver des la premiere publication, et une version fausse est
    pire qu'aucune version — c'est la premiere chose qu'on demande a un
    utilisateur qui signale un defaut.
  */
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
