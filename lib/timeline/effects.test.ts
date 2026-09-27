// Tests des effets : `node --test lib/timeline/`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Clip, Track } from './types';
import {
  zoomScaleAt, zoomEase, transitionAt, transitionStyles, transitionDurationPx, zoomExpr, xfadeName, pickTransitionTarget,
} from './effects.ts';

const tracks: Track[] = [{ id: 1, type: 'video', name: 'V1' }];
const img = (id: string, start: number, width: number, extra: Partial<Clip> = {}): Clip =>
  ({ id, name: id, type: 'image', track: 1, start, width, src: `${id}.png`, ...extra });

test('zoom : désactivé ou absent = échelle 1', () => {
  assert.equal(zoomScaleAt(img('a', 0, 300), 150), 1);
  assert.equal(zoomScaleAt(img('a', 0, 300, { fx: { zoom: { enabled: false, direction: 'in', depth: 50, curve: 'linear' } } }), 150), 1);
});

test('zoom in linéaire : 1 → 1 + profondeur', () => {
  const c = img('a', 100, 300, { fx: { zoom: { enabled: true, direction: 'in', depth: 20, curve: 'linear' } } });
  assert.equal(zoomScaleAt(c, 100), 1);
  assert.ok(Math.abs(zoomScaleAt(c, 250) - 1.1) < 1e-9);
  assert.ok(Math.abs(zoomScaleAt(c, 400) - 1.2) < 1e-9);
  assert.ok(Math.abs(zoomScaleAt(c, 9999) - 1.2) < 1e-9); // borné
});

test('zoom out : part de 1 + profondeur, finit à 1', () => {
  const c = img('a', 0, 300, { fx: { zoom: { enabled: true, direction: 'out', depth: 50, curve: 'linear' } } });
  assert.ok(Math.abs(zoomScaleAt(c, 0) - 1.5) < 1e-9);
  assert.ok(Math.abs(zoomScaleAt(c, 300) - 1) < 1e-9);
});

test('courbe exponentielle : mêmes bornes, plus lente au début', () => {
  assert.equal(zoomEase(0, 'exponential'), 0);
  assert.ok(Math.abs(zoomEase(1, 'exponential') - 1) < 1e-9);
  assert.ok(zoomEase(0.5, 'exponential') < 0.5);
});

test('transition : active au début du clip, part du clip précédent', () => {
  const a = img('a', 0, 300);
  const b = img('b', 300, 300, { transition: { type: 'dissolve', duration: 30 } });
  const clips = [a, b];
  assert.equal(transitionAt(b, clips, tracks, 299), null);
  const mid = transitionAt(b, clips, tracks, 315);
  assert.ok(mid);
  assert.equal(mid.from?.id, 'a');
  assert.ok(Math.abs(mid.progress - 0.5) < 1e-9);
  assert.equal(transitionAt(b, clips, tracks, 330), null);
});

test('transition après un trou : part du noir', () => {
  const a = img('a', 0, 100);
  const b = img('b', 300, 300, { transition: { type: 'fade', duration: 30 } });
  assert.equal(transitionAt(b, [a, b], tracks, 310)?.from, null);
});

test('durée de transition bornée à la moitié du clip', () => {
  assert.equal(transitionDurationPx(img('b', 0, 40, { transition: { type: 'dissolve', duration: 90 } })), 20);
});

test('styles : fondu au noir en deux temps, fondu enchaîné progressif', () => {
  assert.equal(transitionStyles('fade', 0.25).incoming.opacity, 0);
  assert.equal(transitionStyles('fade', 0.25).outgoing.opacity, 0.5);
  assert.equal(transitionStyles('fade', 0.75).incoming.opacity, 0.5);
  assert.equal(transitionStyles('dissolve', 0.3).incoming.opacity, 0.3);
  assert.equal(transitionStyles('wipeleft', 0).incoming.clipPath, 'inset(0 0 0 100.00%)');
  assert.equal(xfadeName('fade'), 'fadeblack');
  assert.equal(xfadeName('dissolve'), 'fade');
  assert.equal(xfadeName('circleopen'), 'circleopen');
});

test('expression ffmpeg du zoom', () => {
  const c = img('a', 0, 300, { fx: { zoom: { enabled: true, direction: 'in', depth: 20, curve: 'linear' } } });
  assert.equal(zoomExpr(img('a', 0, 300), 0, 30, 30), null);
  assert.equal(zoomExpr(c, 2, 30, 30), '1+0.2000*(min(1,max(0,(2.0000+on/30)/10.0000)))');
});

test('cible d\'une transition déposée : le raccord entre deux images le plus proche', () => {
  const a = img('a', 0, 300);
  const b = img('b', 300, 300);
  const c = img('c', 600, 300);
  const clips = [a, b, c];
  assert.equal(pickTransitionTarget(clips, 1, 320, 60)?.id, 'b');
  assert.equal(pickTransitionTarget(clips, 1, 580, 60)?.id, 'c');
  // Le début de la timeline n'est pas un raccord : le raccord proche gagne
  assert.equal(pickTransitionTarget(clips, 1, 40, 300)?.id, 'b');
  // Trop loin de tout début de clip
  assert.equal(pickTransitionTarget(clips, 1, 450, 60), null);
  // Autre piste
  assert.equal(pickTransitionTarget(clips, 2, 320, 60), null);
});
