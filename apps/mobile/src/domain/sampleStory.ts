import { StorySchema } from './storySchema';

export const sampleStory = StorySchema.parse({
  schemaVersion: 1,
  id: 'ruzgari-sakladigi-ucurtma',
  title: 'Rüzgârın Sakladığı Uçurtma',
  language: 'tr-TR',
  ageBand: '6-8',
  voice: {
    providerVoice: 'marin',
    globalDirection:
      'Altı-sekiz yaş grubu için sıcak, anlaşılır ve doğal bir Türkçe hikâye anlatımı kullan.',
    speakerProfiles: {
      narrator: 'Sıcak, sakin ve merak uyandıran bir anlatıcı.',
    },
  },
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
          direction: 'Sakin başla; rüzgâr uçurtmayı alınca eğlenceli bir şaşkınlık kat.',
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
          direction: 'Davetkâr ve meraklı söyle; iki seçenek arasında belirgin durakla.',
          audioKey: 'choice',
        },
      ],
      guidanceSegment: {
        id: 'silver-leaf-guidance',
        speaker: 'narrator',
        text: 'Devam etmek için ekrandaki iki seçenekten birini söyle veya seçeneğe dokun.',
        direction: 'Sabırlı, destekleyici ve kısa söyle; düzeltici bir ton kullanma.',
        audioKey: 'guidance',
      },
      options: [
        {
          id: 'listen-to-wind',
          label: 'Rüzgârın sesini dinlemek istiyorum.',
          voiceHints: [
            'rüzgâr',
            'rüzgar',
            'dinlemek',
            'sesi dinle',
            'rüzgârı dinleyelim',
            'rüzgârı seçiyorum',
            'sesi takip edelim',
          ],
          responseSegments: [
            {
              id: 'wind-response',
              speaker: 'narrator',
              text: 'Hepiniz sessiz oluyorsunuz. Önce kuşları, sonra yaprakların hışırtısını duyuyorsun. Metal sesi çalılıkların içinden geliyor. Dalları araladığında gümüş renkli küçük bir yaprak buluyorsun.',
              direction: 'Sessiz ve meraklı başla; hafif gerilimden sıcak bir keşfe geç.',
              audioKey: 'wind',
            },
          ],
        },
        {
          id: 'inspect-stones',
          label: 'Yerdeki taşları incelemek istiyorum.',
          voiceHints: [
            'taş',
            'taşlar',
            'incelemek',
            'yere bak',
            'taşlara bakalım',
            'taşları seçiyorum',
            'yeri inceleyelim',
          ],
          responseSegments: [
            {
              id: 'stones-response',
              speaker: 'narrator',
              text: 'Yerdeki taşlara dikkatlice bakıyorsun. Hepsi gri, ama birinin üzerinde küçük bir yaprak resmi var. Neva taşı çeviriyor. Altından gümüş renkli küçük bir yaprak çıkıyor.',
              direction: 'Dikkatli ve oyuncu söyle; keşif akıllıca ve tatmin edici hissettirsin.',
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
          direction: 'Büyülü ve hafif komik söyle; beklenti duygusuyla bitir.',
          audioKey: 'ending',
        },
      ],
      nextNodeId: null,
    },
  },
});
