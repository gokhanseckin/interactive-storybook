# Ses üretimi ve değerlendirme kaydı

Tarih: 15 Eylül 2026

Model: `gpt-4o-mini-tts`

Temel ses: `marin`

Kapsam: Önce 10 kayıtlık temsili önizleme, ardından kullanıcı onayıyla kalan 76
kayıt üretildi. Oynanabilir kesitteki toplam 86 hikâye parçası tamamlandı.

## İlk 10 kayıtlık önizleme

| Kayıt | Süre | Kontrol noktası |
| --- | ---: | --- |
| `intro-01` | 9,65 sn | Yönlendirmesiz temel anlatıcı tonu ve Türkçe telaffuz |
| `intro-02` | 16,51 sn | Daha uzun anlatıda tempo ve karakter adlarının telaffuzu |
| `intro-03` | 4,85 sn | Anlatıcı temposunun harekete geçerken yükselmesi |
| `intro-04` | 0,86 sn | Lara'nın enerjik ama bağırmayan kısa repliği |
| `intro-05` | 15,60 sn | Hareketli anlatı, “Pof!” efekti ve meraka geçiş |
| `intro-06` | 1,42 sn | Talha'nın kendinden emin kısa repliği |
| `intro-10` | 1,56 sn | Mila'nın doğal ve hafif karakterlendirilmiş repliği |
| `intro-27` | 2,02 sn | Çın Karga'nın tiyatrocu, kuru komedi tonu |
| `choice-01-prompt` | 9,12 sn | Seçenekler arasında tarafsız ton ve duraklama |
| `shared-13` | 2,30 sn | Bay Makara'nın konferansçı ve kendini önemli gören tonu |

## Tam üretim sonucu

- Önceden üretilmiş 10 kayıt yeniden oluşturulmadan korundu.
- Eksik 76 kayıt `gpt-4o-mini-tts` ve `marin` sesiyle üretildi.
- Hikâye grafiğindeki 86 ses kimliğinin tamamı diskte tam olarak bir MP3 dosyasıyla
  eşleşiyor; eksik veya fazla dosya yok.
- 86 dosyanın tamamı `afinfo` ile geçerli bulundu. Hepsi tek kanallı, 24 kHz,
  128 kb/sn MP3.
- Toplam ses süresi 437,088 saniye (7 dakika 17,088 saniye), toplam dosya boyutu
  6.993.408 bayt.
- En kısa kayıt `intro-15` (0,816 sn), en uzun kayıt `choice-01-b-01`
  (20,400 sn).
- Android Expo dışa aktarımı, 86 hikâye MP3'ünün tamamını paketleyerek geçti.

## Dinleme sırasında değerlendirilecekler

- Anlatıcının Türkçesi doğal ve yaş grubuna uygun mu?
- Art arda gelen `intro-01`–`intro-06` kayıtları aynı kişiden çıkmış gibi tutarlı
  mı?
- Kısa karakter replikleri fazla keskin veya yapay başlıyor mu?
- Lara, Talha, Mila, Çın Karga ve Bay Makara aynı temel ses içinde yeterince
  ayrışıyor mu?
- “Pof!” doğal mı, yoksa ayrıca ses efekti kullanmak daha mı iyi olur?
- Seçim sorusu iki seçeneği gerçekten tarafsız sunuyor mu?
- Her iki seçim kolundan ortak bölüme geçişte ses seviyesi ve anlatıcı tonu
  tutarlı mı?
