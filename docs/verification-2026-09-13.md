# Verification report — 2026-09-13

## Completed

- Mobile TypeScript check passed.
- Mobile test suite passed: 13 tests in 2 files.
- Audio API TypeScript check passed.
- Audio API test suite passed: 1 test.
- The synthetic live OpenAI speech check passed: TTS generated 65,664 bytes and
  `gpt-4o-mini-transcribe` returned the exact Turkish source sentence,
  “Rüzgârın sesini dinlemek istiyorum.” No child recording was used.
- Expo public configuration generation passed and contains the localized iOS
  microphone and speech-recognition usage descriptions.
- Expo Android prebuild passed with Node 22.23.2.
- The final JavaScript/TypeScript source produced an Android Hermes bundle with
  Metro after the locale-pack safety check was added.
- Android debug APK compilation passed: 519 Gradle tasks, using JDK 17.0.20.1,
  compile/target SDK 36, Build Tools 36.0.0, NDK 27.1.12297006, and the
  autolinked `expo-speech-recognition` 57.0.0 native module.
- ADB 37.0.1 starts successfully and can enumerate devices.

The Android build was generated in a temporary directory so native generated
files did not alter the managed Expo source tree.

## Deferred for this spike

- Physical-device acceptance testing was intentionally deferred for the Masal Yolu
  foundation spike. At verification time, no Android device was connected to
  ADB and Xcode reported both known iPhones as offline.
- This deferral is not a production sign-off. Before an App Store or Play Store
  release, run the eight real-device acceptance checks in the repository README
  on representative iOS and Android devices for every supported locale.

The OpenAI key remains server-only in the ignored `services/audio-api/.env`
file and must never be added to the mobile application or committed.

## Playable story slice update

- The Turkish story graph now contains one opening, one two-way choice with
  both responses, and one shared passage that stops immediately before the
  second interactive choice.
- The graph contains 86 speaker-separated audio records with stable ids.
- Turkish global direction, reusable speaker profiles, and optional clip-level
  direction are validated as separate fields.
- Source-wording checks passed for the opening, both first-choice responses,
  and the shared passage. The documented “Adı Çın.” continuity introduction is
  the only added story sentence.
- Mobile verification currently passes: 23 tests in 4 files plus TypeScript.
- Audio service verification currently passes: 2 tests plus TypeScript.
- Kullanıcı tarafından onaylanan 10 kayıtlık ses önizlemesi 15 Eylül 2026'da
  üretildi; ardından ayrı kullanıcı onayıyla kalan 76 kayıt tamamlandı. Mevcut
  10 önizleme dosyası korunarak yalnızca eksik kayıtlar API'ye gönderildi.
- Hikâye grafiğindeki 86 ses kimliği 86 MP3 dosyasıyla bire bir eşleşiyor; eksik
  veya fazla dosya yok. Dosyaların tamamı geçerli, tek kanallı, 24 kHz,
  128 kb/sn MP3'tür.
- Toplam ses süresi 437,088 saniye (7 dakika 17,088 saniye), toplam boyut
  6.993.408 bayttır. Kayıt süreleri 0,816–20,400 saniye arasındadır.
- Tam üretim sonrasında mobil testler (23/23), ses servisi testleri (2/2), iki
  TypeScript kontrolü ve 86 hikâye MP3'ünün tamamını içeren Android Expo dışa
  aktarımı geçti.
- Seçimler arasındaki ayrı MP3'ler tek bir sürüklenebilir zaman çizgisi olarak
  doğrulandı. Simülatörde duraklatılmış, oynayan ve tamamlanmış durumlarda ileri
  ve geri sarma doğru kayda ve kayıt içi saniyeye geçti.
- Üretilen MP3'ler Git tarafından yok sayılır; üretim derlemelerine ayrı artifact
  veya object-storage iş akışıyla sağlanmalıdır.
- Fiziksel cihazda dinleme ve kabul testi, önceki kullanıcı kararı doğrultusunda
  ertelenmiş olarak kalmaktadır.
