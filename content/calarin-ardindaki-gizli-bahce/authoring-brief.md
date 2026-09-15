# Çalıların Ardındaki Gizli Bahçe — authoring brief

Status: First playable slice approved and implemented

## First playable slice

The initial implementation intentionally stops when Bay Makara says “Birini
seçin,” before the second choice becomes interactive. It contains one opening
narration, the first choice and both short outcomes, then one shared passage.
The playable edition uses compact, speaker-separated audio records. A reusable
Turkish voice profile supplies each character's normal delivery; a clip-level
direction is included only when that moment needs a special tone, pace, pause,
or emphasis.

One continuity correction is included in the playable copy: “Adı Çın.” is added
when the crow first appears, because later lines already call the character Çın
Karga.

Source of truth: `source.md`

Language: Turkish (`tr-TR`)

Target age: 8–10

Point of view: Second person; the listener is Mila

## Initial assessment

The manuscript is approximately 4,000 words and contains ten binary choices.
Every option plays a short cosmetic outcome, then returns to the same fixed
story sequence. Choices reward observation, listening, memory, and collaboration without
punishing the child for selecting the less direct option.

Do not rewrite the source while preparing the app edition. Editorial changes
belong in the structured edition and must remain reviewable against
`source.md`.

## Recommended release shape

Publish the story as three connected episodes rather than one long audio file:

1. **Bahçeye Giriş** — choices 1–3; ends after the map is recovered and the
   distant bell rings.
2. **Kuleye Giden Yol** — choices 4–7; ends when the mirror door closes and the
   clock tower comes fully into view.
3. **Saat Kulesinin Hazinesi** — choices 8–10, the treasure, the return journey,
   and the north-key hook.

This keeps listening sessions manageable, gives each episode a natural
cliffhanger, and allows narration to be generated and reviewed in smaller
batches. Progress should carry the three-choice history into the next episode
even though every option returns to the same story sequence.

## Voice direction

Start with one consistent OpenAI voice (`marin`) across the production, using
separate clips and performance directions for each speaker. Evaluate a
multi-voice cast only after the first episode sounds coherent; distinct voices
should not come at the expense of continuity or intelligibility.

| Speaker | Performance direction |
| --- | --- |
| Narrator | Warm, vivid Turkish storyteller. Clear for ages 8–10; curious rather than babyish. Let suspense breathe and keep action energetic. |
| Mila | Calm, capable, and curious. The listener inhabits Mila, so avoid imposing a strong personality or exaggerated voice. |
| Lara | Quick, playful, openly curious, and expressive. Bright energy without shouting. |
| Talha | Grounded, mildly cautious, with dry comic timing. Never cynical. |
| Neva | Quiet, observant, and precise. Short lines should feel thoughtful and important. |
| Çın Karga | Theatrical and deadpan, with grand pauses around absurd statements. Mysterious but never frightening. |
| Bay Makara | Cheerful, self-important lecturer. Rhythmic delivery and comic confidence. |
| Fısfıs | Sleepy, slightly weary stone fish with gentle sneeze comedy. Keep every word intelligible. |
| Mösyö Pıt | Polite, ceremonious, and playfully dramatic. Avoid a caricatured foreign accent. |
| Tik-Tak | Small clockwork character. Crisp, measured phrases with subtle mechanical rhythm; do not sound robotic or threatening. |

## Segmentation rules

- Keep narration clips around 25–60 words where the prose permits.
- Give direct dialogue its own speaker segment; do not mix two characters in a
  single TTS request.
- Keep a short narration lead-in with its following sound effect when they form
  one beat. Standalone effects such as “DONG!” may be isolated for timing.
- Do not speak Markdown headings, option letters, bold markers, or structural
  separators.
- Preserve the Turkish wording in the approved structured edition. Style text
  controls delivery only and is never spoken.
- End clips at meaningful breaths, discoveries, jokes, or changes of speaker;
  never split in the middle of a sentence.
- Choice prompts must name both alternatives distinctly and pause between them.
- Guidance remains neutral: it explains how to answer but never recommends an
  option.

## Choice authoring map

The visible labels should be shorter than the manuscript sentences. The full
meaning remains in the spoken prompt and option outcome.

| # | Choice A label | Choice B label | Distinguishing voice hints |
| --- | --- | --- | --- |
| 1 | Hemen patikadan ilerle | Önce girişi incele | `patikadan git`, `hemen ilerle`, `topu ara` / `etrafa bak`, `girişi incele`, `önce bakalım` |
| 2 | Taşlardaki okları izle | Mavi kurdeleleri izle | `oklar`, `taş yolu`, `sağdaki yol` / `kurdeleler`, `mavi yol`, `soldaki yol` |
| 3 | Suyun sesini dinle | Sembolleri incele | `dinle`, `su sesi`, `kulağımı kullan` / `semboller`, `taşlara bak`, `gözümü kullan` |
| 4 | Taşlardan geç | Tahta geçitten git | `taşlar`, `kısa yol`, `derenin içi` / `tahta geçit`, `köprü`, `uzun yol` |
| 5 | Ana kapıyı aç | Başka bir giriş ara | `ana kapı`, `kapıyı aç`, `önden gir` / `arka kapı`, `başka giriş`, `etrafını dolaş` |
| 6 | Haritayı takip et | Güneş işaretlerini takip et | `harita`, `sol yol` / `güneş`, `işaretler`, `sağ yol` |
| 7 | Aynaları numara sırasıyla çevir | Işığın yolunu takip et | `numara sırası`, `bir iki üç` / `ışık`, `yansıma`, `yıldızı aydınlat` |
| 8 | Kısa yolu seç | Uzun yolu seç | `kısa`, `hızlı yol` / `uzun`, `kolay yol` |
| 9 | Gümüş anahtarı güneşte dene | Gümüş anahtarı ayda dene | `güneş kilidi`, `gümüş güneş` / `ay kilidi`, `gümüş ay` |
| 10 | Önce güneşe bas | Önce yıldıza bas | `güneş düğmesi`, `güneşle başla` / `yıldız düğmesi`, `yıldızla başla` |

For every locale, translate the intent and author natural local paraphrases;
do not mechanically translate the Turkish hint list.

## Editorial items to resolve before generation

1. **Çın Karga's name:** the character appears first as an unnamed crow, but
   the name “Çın Karga” is used later without an introduction. Recommended fix:
   introduce the name during the first encounter.
2. **Episode split:** approve the recommended three-episode structure or choose
   one continuous approximately 30-minute experience.
3. **Mila's spoken lines:** keep the second-person protagonist mostly neutral.
   The few quoted Mila lines can use the narrator voice with a lighter direct
   delivery rather than establishing a separate strong character voice.
4. **Age-band schema:** add an explicit `8-10` value before importing the
   structured edition; mapping this manuscript to `9-12` would exclude part of
   the intended audience.

## Production order

1. Approve the episode split and the Çın Karga continuity fix.
2. Structure episode 1 into speaker-level segments with stable ids, styles,
   choice labels, and voice hints.
3. Generate a short narrator-and-cast preview before generating the full audio
   batch.
4. Review wording, pronunciation, pacing, and character distinction.
5. Generate episode 1 assets, validate the graph, and integrate it into the
   player.
6. Repeat for episodes 2 and 3, then prepare locale-specific adaptations.
