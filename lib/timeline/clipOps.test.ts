// Tests des helpers purs : `node --test lib/timeline/` (Node 22, effacement de types).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Clip, Track } from './types';
import {
  splitClip, computeRipple, overlapsOnTrack, findFreeStart, findFreeGroupDelta,
  neighborBounds, findActiveVisual, findActiveAudio, mediaTimeSec, clipEdges, isClipLocked, newId, trimBounds, clamp,
} from './clipOps.ts';

const clip = (id: string, track: number, start: number, width: number, extra: Partial<Clip> = {}): Clip => ({
  id, name: id, type: 'video', track, start, width, src: `${id}.mp4`, ...extra,
});

const TRACKS: Track[] = [
  { id: 0, type: 'text', name: 'Texte' },
  { id: 1, type: 'video', name: 'Video 1' },
  { id: 2, type: 'audio', name: 'Audio 1' },
  { id: 3, type: 'video', name: 'Video 2' },
];

test('newId : préfixe + 8 caractères', () => {
  const id = newId('clip');
  assert.match(id, /^clip_[0-9a-f]{8}$/);
  assert.notEqual(newId('clip'), id);
});

test('mediaTimeSec : tient compte du point d\'entrée', () => {
  assert.equal(mediaTimeSec(clip('a', 1, 60, 90), 60), 0);
  assert.equal(mediaTimeSec(clip('a', 1, 60, 90, { offset: 30 }), 90), 2);
});

test('splitClip : la moitié droite reprend la source à la coupe', () => {
  const c = clip('a', 1, 100, 200, { offset: 30, transform: { rotationX: 1, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, positionX: 0, positionY: 0 } });
  const res = splitClip(c, 150, ['l', 'r']);
  assert.ok(res);
  const [left, right] = res;
  assert.deepEqual({ id: left.id, start: left.start, width: left.width, offset: left.offset }, { id: 'l', start: 100, width: 50, offset: 30 });
  assert.deepEqual({ id: right.id, start: right.start, width: right.width, offset: right.offset }, { id: 'r', start: 150, width: 150, offset: 80 });
  assert.deepEqual(right.transform, c.transform);
  assert.notEqual(right.transform, c.transform);
});

test('splitClip : offset ignoré pour une image, null près des bords', () => {
  const img = clip('i', 1, 0, 100, { type: 'image' });
  const res = splitClip(img, 40, ['l', 'r'])!;
  assert.equal(res[1].offset, undefined);
  assert.equal(splitClip(img, 3, ['l', 'r']), null);
  assert.equal(splitClip(img, 97, ['l', 'r']), null);
  assert.equal(splitClip(img, 200, ['l', 'r']), null);
});

test('computeRipple : referme le trou par piste, autres pistes intactes', () => {
  const clips = [
    clip('a', 1, 0, 100), clip('b', 1, 100, 50), clip('c', 1, 200, 50),
    clip('x', 3, 100, 50),
  ];
  const res = computeRipple(clips, ['b']);
  assert.deepEqual(res.map(c => [c.id, c.start]), [['a', 0], ['c', 150], ['x', 100]]);
});

test('computeRipple : plusieurs supprimés, du plus tardif au plus tôt', () => {
  const clips = [clip('d1', 1, 0, 100), clip('d2', 1, 200, 100), clip('c', 1, 300, 50), clip('m', 1, 150, 30)];
  const res = computeRipple(clips, ['d1', 'd2']);
  const byId = Object.fromEntries(res.map(c => [c.id, c.start]));
  assert.equal(byId.c, 100);   // recule de 100 (d2) puis de 100 (d1)
  assert.equal(byId.m, 50);    // seulement d1 avant lui
});

test('computeRipple : un clip chevauchant le trou ne bouge pas', () => {
  const clips = [clip('d', 1, 100, 100), clip('o', 1, 150, 100), clip('c', 1, 260, 20)];
  const res = computeRipple(clips, ['d']);
  const byId = Object.fromEntries(res.map(c => [c.id, c.start]));
  assert.equal(byId.o, 150);
  assert.equal(byId.c, 160);
});

test('overlapsOnTrack : même piste seulement, bords qui se touchent = pas de chevauchement', () => {
  const clips = [clip('a', 1, 0, 100), clip('b', 3, 50, 100)];
  assert.equal(overlapsOnTrack(clips, clip('n', 1, 50, 10)), true);
  assert.equal(overlapsOnTrack(clips, clip('n', 1, 100, 10)), false);
  assert.equal(overlapsOnTrack(clips, clip('n', 3, 0, 50)), false);
  assert.equal(overlapsOnTrack(clips, clip('n', 1, 50, 10), new Set(['a'])), false);
  // Le candidat ne se chevauche pas lui-même
  assert.equal(overlapsOnTrack(clips, clip('a', 1, 10, 10)), false);
});

test('findFreeStart : saute les clips gênants en chaîne', () => {
  const clips = [clip('a', 1, 0, 100), clip('b', 1, 100, 50), clip('c', 1, 200, 50)];
  assert.equal(findFreeStart(clips, clip('n', 1, 20, 30)), 150);
  assert.equal(findFreeStart(clips, clip('n', 1, 20, 60)), 250);
  assert.equal(findFreeStart(clips, clip('n', 1, 160, 10)), 160);
  assert.equal(findFreeStart(clips, clip('n', 3, 20, 30)), 20);
});

test('findFreeGroupDelta : décale le groupe entier', () => {
  const clips = [clip('a', 1, 0, 100), clip('b', 3, 120, 50)];
  const group = [clip('g1', 1, 50, 20), clip('g2', 3, 100, 20)];
  // g1 gêné par a → delta 50 ; g2 à 150 est libre (b finit à 170 mais g2 [150,170] chevauche b !) → 70
  assert.equal(findFreeGroupDelta(clips, group), 70);
  assert.equal(findFreeGroupDelta(clips, [clip('g', 1, 100, 10)]), 0);
});

test('neighborBounds : voisins de la même piste', () => {
  const clips = [clip('a', 1, 0, 100), clip('me', 1, 150, 50), clip('c', 1, 300, 50), clip('x', 3, 150, 10)];
  assert.deepEqual(neighborBounds(clips, clips[1]), { prevEnd: 100, nextStart: 300 });
  assert.deepEqual(neighborBounds(clips, clips[0]), { prevEnd: 0, nextStart: 150 });
  assert.deepEqual(neighborBounds(clips, clips[2]), { prevEnd: 200, nextStart: Infinity });
});

test('findActiveVisual : couche du dessus, puis start max ; pistes masquées ignorées', () => {
  const clips = [clip('a', 1, 0, 300), clip('b', 3, 100, 100), clip('a2', 1, 150, 100), clip('t', 0, 0, 300, { type: 'text' })];
  assert.equal(findActiveVisual(clips, TRACKS, 50)?.id, 'a');
  assert.equal(findActiveVisual(clips, TRACKS, 120)?.id, 'b');
  assert.equal(findActiveVisual(clips, TRACKS, 199.9)?.id, 'b');
  assert.equal(findActiveVisual(clips, TRACKS, 200)?.id, 'a2');   // start max sur la même piste
  assert.equal(findActiveVisual(clips, TRACKS, 300), null);
  const hidden = TRACKS.map(t => t.id === 3 ? { ...t, hidden: true } : t);
  assert.equal(findActiveVisual(clips, hidden, 120)?.id, 'a');
  // Clip sur une piste inexistante : ignoré
  assert.equal(findActiveVisual([clip('z', 9, 0, 100)], TRACKS, 10), null);
});

test('findActiveAudio : muted piste/clip', () => {
  const clips = [clip('s', 2, 0, 100, { type: 'audio' }), clip('m', 2, 50, 100, { type: 'audio', muted: true })];
  assert.equal(findActiveAudio(clips, TRACKS, 60)?.id, 's');   // m est muet
  const muted = TRACKS.map(t => t.id === 2 ? { ...t, muted: true } : t);
  assert.equal(findActiveAudio(clips, muted, 60), null);
  // Un clip vidéo n'est jamais un clip audio actif
  assert.equal(findActiveAudio([clip('v', 1, 0, 100)], TRACKS, 10), null);
});

test('clipEdges et isClipLocked', () => {
  const clips = [clip('a', 1, 10, 20), clip('b', 3, 30, 20), clip('c', 2, 5, 5, { type: 'audio' })];
  assert.deepEqual(clipEdges(clips, new Set([1, 3])), [0, 10, 30, 50]);
  const locked = TRACKS.map(t => t.id === 1 ? { ...t, locked: true } : t);
  assert.equal(isClipLocked(clips[0], locked), true);
  assert.equal(isClipLocked(clips[1], locked), false);
});

test('clipEdges : 0 toujours présent, bords dédoublonnés et triés, pistes filtrées', () => {
  const clips = [clip('a', 1, 0, 50), clip('b', 1, 50, 50), clip('c', 3, 20, 10), clip('d', 2, 200, 10, { type: 'audio' })];
  assert.deepEqual(clipEdges(clips, new Set([1, 3])), [0, 20, 30, 50, 100]);
  assert.deepEqual(clipEdges(clips, new Set([2])), [0, 200, 210]);
  assert.deepEqual(clipEdges([], new Set([1])), [0]);
});

test('trimBounds : offset et sourceDuration bornent un clip vidéo', () => {
  const clips = [clip('p', 1, 0, 40), clip('me', 1, 100, 60, { offset: 30, sourceDuration: 120 }), clip('n', 1, 300, 20)];
  const b = trimBounds(clips, clips[1]);
  // Gauche : offset 30 → au plus 30 px plus tôt (70), voisin de gauche fini à 40
  assert.equal(b.minStart, 70);
  assert.equal(b.maxStart, 160 - 5);
  assert.equal(b.minEnd, 100 + 5);
  // Droite : source finit à 100 − 30 + 120 = 190 < voisin (300)
  assert.equal(b.maxEnd, 190);
});

test('trimBounds : voisins seulement pour une image ; Infinity sans voisin ni source', () => {
  const clips = [clip('p', 1, 0, 40), clip('img', 1, 100, 60, { type: 'image' })];
  const b = trimBounds(clips, clips[1]);
  assert.deepEqual(b, { minStart: 40, maxStart: 155, minEnd: 105, maxEnd: Infinity });
  // Vidéo sans offset ni source, voisin de droite
  const v = [clip('me', 1, 100, 60), clip('n', 1, 200, 10)];
  assert.deepEqual(trimBounds(v, v[0]), { minStart: 100, maxStart: 155, minEnd: 105, maxEnd: 200 });
});

test('trimBounds + clamp : un point d\'aimant au-delà des bornes est ramené', () => {
  const clips = [clip('me', 1, 100, 60, { offset: 10, sourceDuration: 100 }), clip('n', 1, 170, 10)];
  const b = trimBounds(clips, clips[0]);
  assert.equal(clamp(50, b.minStart, b.maxStart), 90);      // aimant à 50 → offset 0 (start 90)
  assert.equal(clamp(250, b.minEnd, b.maxEnd), 170);        // aimant à 250 → voisin de droite
  assert.equal(clamp(140, b.minStart, b.maxStart), 140);
});
