import { File } from 'expo-file-system';

import type { ChoiceOption } from '../domain/storySchema';

type ResolveChoiceResponse = {
  optionId: string;
};

function getAudioMimeType(uri: string): string {
  return uri.endsWith('.3gp') ? 'audio/3gpp' : 'audio/mp4';
}

export async function resolveSpokenChoice(
  recordingUri: string,
  options: ChoiceOption[],
): Promise<string> {
  const apiUrl = process.env.EXPO_PUBLIC_AUDIO_API_URL;
  const recording = new File(recordingUri);

  try {
    if (!apiUrl) {
      throw new Error('Ses seçimi sunucusu henüz ayarlanmadı. Seçeneğe dokunabilirsin.');
    }

    const form = new FormData();
    form.append('audio', {
      uri: recordingUri,
      name: recordingUri.endsWith('.3gp') ? 'choice.3gp' : 'choice.m4a',
      type: getAudioMimeType(recordingUri),
    } as unknown as Blob);
    form.append(
      'options',
      JSON.stringify(
        options.map(({ id, label, voiceHints }) => ({ id, label, voiceHints })),
      ),
    );

    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/choices/resolve`, {
      method: 'POST',
      body: form,
    });

    if (!response.ok) {
      throw new Error(
        response.status === 422
          ? 'Söylediğin seçeneği anlayamadım. Tekrar söyleyebilir veya dokunabilirsin.'
          : 'Ses seçimi şu anda kullanılamıyor. Seçeneğe dokunabilirsin.',
      );
    }

    const result = (await response.json()) as ResolveChoiceResponse;
    if (!options.some(({ id }) => id === result.optionId)) {
      throw new Error('Ses seçimi geçersiz bir yanıt verdi. Seçeneğe dokunabilirsin.');
    }

    return result.optionId;
  } finally {
    if (recording.exists) recording.delete();
  }
}
