import { StorySchema } from './storySchema';

export const sampleStory = StorySchema.parse({
  schemaVersion: 1,
  id: 'ruzgari-sakladigi-ucurtma',
  title: 'Rüzgârın Sakladığı Uçurtma',
  language: 'tr-TR',
  ageBand: '6-8',
  episode: {
    number: 1,
    title: 'Duvarın Ötesi',
  },
  entryNodeId: 'park',
  nodes: {
    park: {
      id: 'park',
      kind: 'narration',
      segments: [
        {
          id: 'park-intro',
          speaker: 'narrator',
          text: "Mila, kardeşi Lara ve arkadaşları Talha ile Neva parkta uçurtma uçuruyordu. Birden güçlü bir rüzgâr esti. Fırr! Uçurtmanın ipi Mila'nın elinden kaçtı. Kırmızı uçurtma, parkın sonundaki eski duvarın arkasına düştü.",
          style: 'Warm Turkish storytelling. Begin gently, then add playful surprise when the wind takes the kite.',
          audioKey: 'intro',
        },
      ],
      nextNodeId: 'silver-leaf-choice',
    },
    'silver-leaf-choice': {
      id: 'silver-leaf-choice',
      kind: 'choice',
      promptSegments: [
        {
          id: 'silver-leaf-prompt',
          speaker: 'narrator',
          text: 'Gümüş yaprağı nasıl aramak istersin? Rüzgârın sesini mi dinleyelim, yoksa yerdeki taşları mı inceleyelim?',
          style: 'Inviting and curious. Pause clearly between the two choices.',
          audioKey: 'choice',
        },
      ],
      guidanceSegment: {
        id: 'silver-leaf-guidance',
        speaker: 'narrator',
        text: 'Devam etmek için ekrandaki iki seçenekten birini söyle veya seçeneğe dokun.',
        style: 'Patient, supportive and concise. Do not sound corrective.',
        audioKey: 'guidance',
      },
      options: [
        {
          id: 'listen-to-wind',
          label: 'Rüzgârın sesini dinlemek istiyorum.',
          voiceHints: ['rüzgâr', 'rüzgar', 'dinlemek', 'sesi dinle'],
          responseSegments: [
            {
              id: 'wind-response',
              speaker: 'narrator',
              text: 'Hepiniz sessiz oluyorsunuz. Önce kuşları, sonra yaprakların hışırtısını duyuyorsun. Metal sesi çalılıkların içinden geliyor. Dalları araladığında gümüş renkli küçük bir yaprak buluyorsun.',
              style: 'Quiet, mysterious and curious. Build gentle suspense, then end with warm discovery.',
              audioKey: 'wind',
            },
          ],
        },
        {
          id: 'inspect-stones',
          label: 'Yerdeki taşları incelemek istiyorum.',
          voiceHints: ['taş', 'taşlar', 'incelemek', 'yere bak'],
          responseSegments: [
            {
              id: 'stones-response',
              speaker: 'narrator',
              text: 'Yerdeki taşlara dikkatlice bakıyorsun. Hepsi gri, ama birinin üzerinde küçük bir yaprak resmi var. Neva taşı çeviriyor. Altından gümüş renkli küçük bir yaprak çıkıyor.',
              style: 'Observant and playful. Let the discovery feel clever and satisfying.',
              audioKey: 'stones',
            },
          ],
        },
      ],
      nextNodeId: 'green-door',
    },
    'green-door': {
      id: 'green-door',
      kind: 'narration',
      segments: [
        {
          id: 'green-door-ending',
          speaker: 'narrator',
          text: "Gümüş yaprağı kapının ortasındaki boşluğa yerleştiriyorsun. Klik! Yeşil kapı açılıyor. Pirinç burun bir kez daha hapşırıyor. 'Uçurtmanız içeride,' diyor. 'Ama Uykucu Köprü'yü uyandırmanız gerekecek.'",
          style: 'Magical, lightly comic and forward-looking. Finish with anticipation.',
          audioKey: 'ending',
        },
      ],
      nextNodeId: null,
    },
  },
});
