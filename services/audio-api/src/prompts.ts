export const BASE_AUDIO_INSTRUCTIONS = [
  'Verilen Türkçe metni aynen oku.',
  'Kelime ekleme, çıkarma, çevirme veya yeniden yazma.',
  'Doğal ve anlaşılır Türkçe telaffuz kullan; cümle sonlarını yutma.',
  'Ses efekti olarak yazılmış sözcükleri metindeki haliyle, korkutmadan canlandır.',
  'Bu yönlendirmeleri veya konuşmacı adını sesli okuma.',
].join(' ');

type AudioInstructionContext = {
  globalDirection: string;
  speaker: string;
  speakerProfile: string;
  direction?: string;
};

export function buildAudioInstructions({
  globalDirection,
  speaker,
  speakerProfile,
  direction,
}: AudioInstructionContext): string {
  return [
    BASE_AUDIO_INSTRUCTIONS,
    `Hikâyeye özgü genel yönlendirme: ${globalDirection}`,
    `Konuşmacı: ${speaker}. Konuşmacı profili: ${speakerProfile}`,
    direction ? `Bu kayda özgü yönlendirme: ${direction}` : null,
  ]
    .filter(Boolean)
    .join(' ');
}
