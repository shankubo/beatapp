import { describe, expect, it } from 'vitest';
import { focalPointOf } from '@/engine/salience';

function makeCanvas(w: number, h: number, paint: (c: OffscreenCanvasRenderingContext2D) => void) {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, w, h);
  paint(ctx);
  return canvas as unknown as HTMLCanvasElement;
}

describe('focalPointOf', () => {
  it('trouve une zone detaillee placee en haut', () => {
    const c = makeCanvas(400, 800, (ctx) => {
      // Damier haute frequence dans le tiers superieur.
      for (let y = 80; y < 200; y += 6) {
        for (let x = 120; x < 280; x += 6) {
          ctx.fillStyle = (x + y) % 12 === 0 ? '#ffffff' : '#000000';
          ctx.fillRect(x, y, 6, 6);
        }
      }
    });
    const focal = focalPointOf(c);
    expect(focal).not.toBeNull();
    expect(focal!.y).toBeLessThan(0.4);
    expect(Math.abs(focal!.x - 0.5)).toBeLessThan(0.15);
  });

  it('trouve une zone placee en bas a droite', () => {
    const c = makeCanvas(400, 400, (ctx) => {
      for (let y = 280; y < 380; y += 5) {
        for (let x = 280; x < 380; x += 5) {
          ctx.fillStyle = (x + y) % 10 === 0 ? '#ffffff' : '#000000';
          ctx.fillRect(x, y, 5, 5);
        }
      }
    });
    const focal = focalPointOf(c);
    expect(focal).not.toBeNull();
    expect(focal!.x).toBeGreaterThan(0.6);
    expect(focal!.y).toBeGreaterThan(0.6);
  });

  it('renvoie null sur une image unie', () => {
    const c = makeCanvas(300, 300, () => {});
    expect(focalPointOf(c)).toBeNull();
  });

  it('renvoie null sur un degrade doux', () => {
    const c = makeCanvas(300, 300, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 300);
      g.addColorStop(0, '#6080a0');
      g.addColorStop(1, '#a0c0e0');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 300, 300);
    });
    expect(focalPointOf(c)).toBeNull();
  });
});
