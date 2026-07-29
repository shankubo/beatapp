/**
 * Genere toutes les tailles d'icones pour iOS, Android et PC/Web
 * a partir de public/icons/logo_bg.png
 *
 * Usage : node scripts/generate-icons.mjs
 */

import sharp from 'sharp';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SOURCE = join(ROOT, 'public', 'icons', 'logo_bg.png');

// --- Tailles iOS ---
// Source : Apple Human Interface Guidelines
const IOS_ICONS = [
  // iPhone notification
  { name: 'ios/AppIcon-20@1x.png',   size: 20  },
  { name: 'ios/AppIcon-20@2x.png',   size: 40  },
  { name: 'ios/AppIcon-20@3x.png',   size: 60  },
  // iPhone settings
  { name: 'ios/AppIcon-29@1x.png',   size: 29  },
  { name: 'ios/AppIcon-29@2x.png',   size: 58  },
  { name: 'ios/AppIcon-29@3x.png',   size: 87  },
  // iPhone spotlight
  { name: 'ios/AppIcon-40@1x.png',   size: 40  },
  { name: 'ios/AppIcon-40@2x.png',   size: 80  },
  { name: 'ios/AppIcon-40@3x.png',   size: 120 },
  // iPhone app icon
  { name: 'ios/AppIcon-60@2x.png',   size: 120 },
  { name: 'ios/AppIcon-60@3x.png',   size: 180 },
  // iPad notification
  { name: 'ios/AppIcon-iPad-20@1x.png', size: 20 },
  { name: 'ios/AppIcon-iPad-20@2x.png', size: 40 },
  // iPad settings
  { name: 'ios/AppIcon-iPad-29@1x.png', size: 29 },
  { name: 'ios/AppIcon-iPad-29@2x.png', size: 58 },
  // iPad spotlight
  { name: 'ios/AppIcon-iPad-40@1x.png', size: 40 },
  { name: 'ios/AppIcon-iPad-40@2x.png', size: 80 },
  // iPad app icon
  { name: 'ios/AppIcon-iPad-76@1x.png', size: 76  },
  { name: 'ios/AppIcon-iPad-76@2x.png', size: 152 },
  // iPad Pro
  { name: 'ios/AppIcon-iPad-83.5@2x.png', size: 167 },
  // App Store
  { name: 'ios/AppIcon-1024.png',    size: 1024 },
];

// --- Tailles Android ---
// Source : Android developer docs (adaptive icons + legacy)
const ANDROID_ICONS = [
  { name: 'android/mipmap-mdpi/ic_launcher.png',     size: 48  },
  { name: 'android/mipmap-hdpi/ic_launcher.png',     size: 72  },
  { name: 'android/mipmap-xhdpi/ic_launcher.png',    size: 96  },
  { name: 'android/mipmap-xxhdpi/ic_launcher.png',   size: 144 },
  { name: 'android/mipmap-xxxhdpi/ic_launcher.png',  size: 192 },
  // Google Play Store
  { name: 'android/play-store-512.png',              size: 512 },
  // Notification (blanc sur fond transparent non genere ici — taille uniquement)
  { name: 'android/mipmap-mdpi/ic_launcher_round.png',    size: 48  },
  { name: 'android/mipmap-hdpi/ic_launcher_round.png',    size: 72  },
  { name: 'android/mipmap-xhdpi/ic_launcher_round.png',   size: 96  },
  { name: 'android/mipmap-xxhdpi/ic_launcher_round.png',  size: 144 },
  { name: 'android/mipmap-xxxhdpi/ic_launcher_round.png', size: 192 },
];

// --- Tailles PC / Web / PWA ---
const WEB_ICONS = [
  // Favicons
  { name: 'web/favicon-16.png',   size: 16  },
  { name: 'web/favicon-32.png',   size: 32  },
  { name: 'web/favicon-48.png',   size: 48  },
  { name: 'web/favicon-64.png',   size: 64  },
  // Windows tiles
  { name: 'web/tile-70.png',      size: 70  },
  { name: 'web/tile-150.png',     size: 150 },
  { name: 'web/tile-310.png',     size: 310 },
  // macOS / Electron
  { name: 'web/icon-128.png',     size: 128 },
  { name: 'web/icon-256.png',     size: 256 },
  { name: 'web/icon-512.png',     size: 512 },
  { name: 'web/icon-1024.png',    size: 1024 },
  // PWA (manifest)
  { name: 'web/pwa-192.png',      size: 192 },
  { name: 'web/pwa-512.png',      size: 512 },
  // PWA maskable (meme image, le masque vient du manifeste)
  { name: 'web/pwa-maskable-192.png', size: 192 },
  { name: 'web/pwa-maskable-512.png', size: 512 },
];

const ALL_ICONS = [...IOS_ICONS, ...ANDROID_ICONS, ...WEB_ICONS];
const OUT_DIR = join(ROOT, 'public', 'icons', 'generated');

async function generateIcon(source, outPath, size) {
  const dir = dirname(outPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  await sharp(source)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outPath);
}

async function main() {
  console.log(`\nSource : ${SOURCE}`);
  console.log(`Destination : ${OUT_DIR}\n`);

  let ok = 0;
  let ko = 0;

  for (const icon of ALL_ICONS) {
    const outPath = join(OUT_DIR, icon.name);
    try {
      await generateIcon(SOURCE, outPath, icon.size);
      console.log(`  [OK] ${icon.name} (${icon.size}x${icon.size})`);
      ok++;
    } catch (err) {
      console.error(`  [KO] ${icon.name} : ${err.message}`);
      ko++;
    }
  }

  // Copier aussi les icones PWA directement dans public/icons/
  // pour mettre a jour icon-192.png et icon-512.png deja references
  const PWA_COPY = [
    { src: join(OUT_DIR, 'web/pwa-192.png'),          dst: join(ROOT, 'public', 'icons', 'icon-192.png') },
    { src: join(OUT_DIR, 'web/pwa-512.png'),          dst: join(ROOT, 'public', 'icons', 'icon-512.png') },
    { src: join(OUT_DIR, 'web/pwa-maskable-512.png'), dst: join(ROOT, 'public', 'icons', 'icon-maskable-512.png') },
    { src: join(OUT_DIR, 'web/favicon-32.png'),       dst: join(ROOT, 'public', 'favicon.png') },
  ];

  console.log('\n--- Mise a jour des icones PWA references ---');
  for (const { src, dst } of PWA_COPY) {
    try {
      await sharp(src).toFile(dst);
      console.log(`  [OK] ${dst.replace(ROOT, '')}`);
    } catch (err) {
      console.error(`  [KO] ${dst} : ${err.message}`);
    }
  }

  console.log(`\nTermine : ${ok} icones generees, ${ko} echec(s).\n`);

  if (ok > 0) {
    console.log('Repertoires generes :');
    console.log(`  public/icons/generated/ios/         — icones Apple`);
    console.log(`  public/icons/generated/android/     — icones Android`);
    console.log(`  public/icons/generated/web/         — favicon, PWA, Windows, macOS`);
    console.log(`\nPWA mis a jour :`);
    console.log(`  public/icons/icon-192.png`);
    console.log(`  public/icons/icon-512.png`);
    console.log(`  public/icons/icon-maskable-512.png`);
    console.log(`  public/favicon.png`);
  }
}

main().catch((err) => {
  console.error('Erreur fatale :', err);
  process.exit(1);
});
