// Tests du balayage d'export : `node --test lib/timeline/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Clip, Track } from './types';
import { buildVideoSegments, exportableAudioClips } from './segments.ts';

const PX = 30;
const FPS = 30;

const clip = (id: string, track: number, start: number, width: number, extra: Partial<Clip> = {}): Clip => ({
  id, name: id, type: 'video', track, start, width, src: `${id}.mp4`, ...extra,
});

const TRACKS: Track[] = [
  { id: 0, type: 'text', name: 'Texte' },
  { id: 1, type: 'video', name: 'Video 1' },
  { id: 2, type: 'audio', name: 'Audio 1' },
  { id: 3, type: 'video', name: 'Video 2' },
];

const summary = (segs: ReturnType<typeof buildVideoSegments>) =>
  segs.map(s => [s.clip?.id ?? null, s.startSec, s.durationSec, s.inSec]);

test('A/B/A : le clip de la piste du dessus recouvre, A reprend au bon endroit', () => {
  const clips = [clip('A', 1, 0, 300, { offset: 30 }), clip('B', 3, 90, 60)];
  const segs = buildVideoSegments(clips, TRACKS, PX, FPS);
  assert.deepEqual(summary(segs), [
    ['A', 0, 3, 1],      // offset 30 px = 1 s
    ['B', 3, 2, 0],
    ['A', 5, 5, 6],      // 1 s d'offset + 5 s écoulées
  ]);
});

test('trou entre deux clips → segment noir de la bonne durée', () => {
  const clips = [clip('A', 1, 0, 60), clip('B', 1, 150, 30)];
  const segs = buildVideoSegments(clips, TRACKS, PX, FPS);
  assert.deepEqual(summary(segs), [
    ['A', 0, 2, 0],
    [null, 2, 3, 0],
    ['B', 5, 1, 0],
  ]);
});

test('noir en tête et fusion des noirs consécutifs ; audio prolonge la fin', () => {
  const clips = [clip('A', 1, 60, 30), clip('S', 2, 0, 300, { type: 'audio' })];
  const segs = buildVideoSegments(clips, TRACKS, PX, FPS);
  assert.deepEqual(summary(segs), [
    [null, 0, 2, 0],
    ['A', 2, 1, 0],
    [null, 3, 7, 0],
  ]);
});

test('aucun clip visuel mais audio → un seul segment noir ; rien → vide', () => {
  const clips = [clip('S', 2, 30, 120, { type: 'audio' })];
  assert.deepEqual(summary(buildVideoSegments(clips, TRACKS, PX, FPS)), [[null, 0, 5, 0]]);
  assert.deepEqual(buildVideoSegments([], TRACKS, PX, FPS), []);
});

test('piste masquée, source vide et intervalles < ½ image ignorés', () => {
  const clips = [
    clip('A', 1, 0, 300),
    clip('H', 3, 60, 60),                     // piste 3 masquée
    clip('E', 3, 200, 10, { src: '' }),       // sans source
    clip('T', 1, 300, 0.2),                   // < ½ image
  ];
  const tracks = TRACKS.map(t => t.id === 3 ? { ...t, hidden: true } : t);
  const segs = buildVideoSegments(clips, tracks, PX, FPS);
  assert.deepEqual(summary(segs), [['A', 0, 10, 0]]);
});

test('exportableAudioClips : muted piste/clip, piste inexistante', () => {
  const clips = [
    clip('a', 2, 0, 10, { type: 'audio' }),
    clip('m', 2, 0, 10, { type: 'audio', muted: true }),
    clip('z', 9, 0, 10, { type: 'audio' }),
  ];
  assert.deepEqual(exportableAudioClips(clips, TRACKS).map(c => c.id), ['a']);
  const muted = TRACKS.map(t => t.id === 2 ? { ...t, muted: true } : t);
  assert.deepEqual(exportableAudioClips(clips, muted), []);
});
