// Voix prédéfinies de Gemini TTS — sous-ensemble curé.
// Liste complète : https://ai.google.dev/gemini-api/docs/speech-generation
export const GEMINI_VOICES = [
  { id: 'Kore',       label: 'Kore — neutre, claire' },
  { id: 'Puck',       label: 'Puck — masculine, vive' },
  { id: 'Charon',     label: 'Charon — masculine, grave' },
  { id: 'Zephyr',     label: 'Zephyr — féminine, douce' },
  { id: 'Aoede',      label: 'Aoede — féminine, posée' },
  { id: 'Fenrir',     label: 'Fenrir — masculine, énergique' },
  { id: 'Leda',       label: 'Leda — féminine, jeune' },
  { id: 'Orus',       label: 'Orus — masculine, autoritaire' },
] as const;

export type GeminiVoiceId = (typeof GEMINI_VOICES)[number]['id'];
export const DEFAULT_VOICE: GeminiVoiceId = 'Kore';
