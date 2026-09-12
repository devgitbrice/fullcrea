// Voix OpenAI TTS (gpt-4o-mini-tts / tts-1) — toutes multilingues.
// https://platform.openai.com/docs/guides/text-to-speech
export const OPENAI_VOICES = [
  { id: 'coral',   label: 'Coral — féminine, chaleureuse' },
  { id: 'nova',    label: 'Nova — féminine, dynamique' },
  { id: 'shimmer', label: 'Shimmer — féminine, douce' },
  { id: 'sage',    label: 'Sage — féminine, posée' },
  { id: 'alloy',   label: 'Alloy — neutre' },
  { id: 'ash',     label: 'Ash — masculine, claire' },
  { id: 'echo',    label: 'Echo — masculine, grave' },
  { id: 'onyx',    label: 'Onyx — masculine, profonde' },
  { id: 'fable',   label: 'Fable — narrative' },
  { id: 'ballad',  label: 'Ballad — masculine, calme' },
  { id: 'verse',   label: 'Verse — masculine, vive' },
] as const;

export type OpenAIVoiceId = (typeof OPENAI_VOICES)[number]['id'];
export const DEFAULT_OPENAI_VOICE: OpenAIVoiceId = 'coral';
export const isOpenAIVoice = (v: string): v is OpenAIVoiceId => OPENAI_VOICES.some((x) => x.id === v);
