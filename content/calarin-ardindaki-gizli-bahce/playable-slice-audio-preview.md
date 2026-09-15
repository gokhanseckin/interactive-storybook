# Çalıların Ardındaki Gizli Bahçe — oynanabilir bölüm ses planı

Durum: Format onaylandı; 86 parçalık oynanabilir kesit üretildi.

Bu belge, ilk oynanabilir bölüm için onaylanan ses yapısını ve üretimde kullanılan
yönlendirmeleri gösterir. Üretim sonucu `audio-preview-review.md` dosyasında
kaydedilmiştir.

## Kabul edilen yaklaşım

- Hikâyenin Türkçe metni ile yaratıcı seslendirme yönlendirmeleri Türkçe tutulur.
- Her ses kaydında yalnızca bir konuşmacı bulunur.
- Her kayıt, uygulamanın kullanacağı kısa ve kalıcı bir kimlik taşır:
  `intro-01`, `choice-01-a-01`, `shared-01` gibi.
- Ses karakteri her parçada tekrar edilmez. Genel kurallar ve konuşmacı profili
  otomatik olarak her isteğe eklenir.
- `direction` yalnızca o kayda özgü farklı bir ton, vurgu, hız veya duraklama
  gerektiğinde kullanılır.
- Kimlikler, konuşmacı adları ve yönlendirmeler sesli okunmaz.

## Veri biçimi

Normal bir anlatıcı kaydı ek yönlendirmeye ihtiyaç duymaz:

```yaml
id: intro-01
speaker: narrator
text: >
  Öğleden sonra hava çok güzeldi. Ne çok sıcak ne de çok serindi.
  Hafif bir rüzgâr esiyor, ağaçların yapraklarını sallıyordu.
```

Özel bir performans gerektiğinde `direction` eklenir:

```yaml
id: intro-04
speaker: lara
text: "Hazır ol!"
direction: "Dostça bir uyarı gibi söyle; enerjik ol ama bağırma."
```

Ses dosyası anahtarı hikâye kimliği, dil ve kayıt kimliğinden üretilebilir;
editörün ayrıca uzun bir `audioKey` yazması gerekmez:

```text
calilarin-ardindaki-gizli-bahce/tr-TR/intro-04.mp3
```

## TTS isteğinin oluşumu

Ses üretiminde üç katman birleştirilir:

```text
Genel Türkçe seslendirme kuralları
  + konuşmacının ses profili
  + varsa bu kayda özgü direction
```

Örneğin `intro-04` için modele gönderilecek yönlendirme şu yapıda olur:

```text
Metni Türkçe olarak aynen oku; kelime ekleme, çıkarma veya değiştirme.
Lara hızlı, oyuncu, açıkça meraklı ve neşelidir.
Dostça bir uyarı gibi söyle; enerjik ol ama bağırma.
```

Ses profillerinin yalnızca bu şekilde üretim isteğine eklendiklerinde çıktıyı
etkileyeceği kabul edilmiştir. Belgedeki profil metni tek başına ses üretimini
değiştirmez.

## Genel seslendirme kuralları

> Verilen Türkçe metni aynen oku. Kelime ekleme, çıkarma, çevirme veya yeniden
> yazma. Doğal ve anlaşılır Türkçe telaffuz kullan. Sekiz-on yaş grubuna uygun,
> sıcak bir hikâye anlatımı benimse; çocuksu veya abartılı konuşma. Cümle
> sonlarını yutma. Konuşmacı adını ve seslendirme yönlendirmelerini sesli okuma.
> Ses efekti olarak yazılmış sözcükleri metindeki haliyle, korkutmadan canlandır.

## Ses karakterleri

| Konuşmacı | Her kayıtta kullanılan kalıcı profil |
| --- | --- |
| Anlatıcı | Sıcak, canlı ve merak uyandıran bir Türkçe hikâye anlatıcısı. Anlaşılır konuş; gerilimi acele etmeden kur ve hareketli bölümlerde ritmi hafifçe yükselt. |
| Mila | Sakin, becerikli ve meraklı. Dinleyici Mila’nın yerinde olduğu için güçlü bir karakter taklidi veya abartılı oyunculuk kullanma. |
| Lara | Hızlı, oyuncu, açıkça meraklı ve neşeli. Enerjik konuş ama bağırma. |
| Talha | Ayakları yere basan, biraz temkinli ve doğal bir komedi ritmine sahip. Alaycı konuşma. |
| Neva | Sessiz, dikkatli ve ölçülü. Kısa sözleri düşünülmüş ve önemli hissettirsin. |
| Çın Karga | Tiyatrocu ve ciddiymiş gibi davranan komik bir karga. Tuhaf cümlelerin çevresinde görkemli duraklamalar kullan; gizemli ol ama korkutucu olma. |
| Bay Makara | Neşeli ve kendini önemli gören bir konuşmacı. Konferans veriyormuş gibi ritmik ve komik bir özgüven kullan. |

Başlangıçta bütün konuşmacılar için aynı temel OpenAI sesi kullanılabilir. Bu
profiller ton, tempo, vurgu ve duyguya yön verir; tek bir temel sesi bütünüyle
farklı oyunculara dönüştürmesi beklenmez.

## Oynanabilir bölüm haritası

```text
Giriş anlatısı
  → 1. seçim
      ├─ A: hemen patikadan ilerle ┐
      └─ B: önce girişi incele     ┘
  → ortak anlatı
  → Bay Makara: “Birini seçin.”
  → ikinci seçim ekrana gelmeden bölüm sonu
```

## Giriş — örnek kayıt sırası

### `intro-01` · Anlatıcı

> Öğleden sonra hava çok güzeldi. Ne çok sıcak ne de çok serindi. Hafif bir
> rüzgâr esiyor, ağaçların yapraklarını sallıyordu.

Ek yönlendirme yok; anlatıcı profili yeterlidir.

### `intro-02` · Anlatıcı

> Sen Mila’sın. Küçük kardeşin Lara, komşunuz Talha ve onun küçük kardeşi Neva
> ile dışarıda oynuyorsun. Bazen top oynuyor, bazen birbirinizi kovalıyor, bazen
> de topu duvara atıp yakalamaya çalışıyorsunuz.

Ek yönlendirme yok; anlatıcı profili yeterlidir.

### `intro-03` · Anlatıcı

> Lara topu sana doğru fırlatıyor.

Yönlendirme: `Şimdiki harekete geçerken tempoyu hafifçe yükselt.`

### `intro-04` · Lara

> Hazır ol!

Yönlendirme: `Dostça bir uyarı gibi söyle; enerjik ol ama bağırma.`

### `intro-05` · Anlatıcı

> Top biraz fazla yükseğe çıkıyor. Yakalamak için iki adım geri gidiyorsun. Ama
> top parmaklarının üzerinden geçiyor. Pof! Yere çarpıyor. Bir kez daha
> zıplıyor. Ve yolun kenarındaki büyük çalıların arasına giriyor.

Yönlendirme: `Pof sözcüğünü yumuşak bir çarpma sesi gibi canlandır; top çalılarda kaybolurken hafif bir merak oluştur.`

### `intro-06` · Talha

> Ben bulurum!

Yönlendirme: `Hemen öne atılan, arkadaşça ve kendinden emin bir tepki.`

### `intro-07` · Anlatıcı

> Hepiniz çalılara doğru koşuyorsunuz. Bu çalıları daha önce yüzlerce kez
> görmüştünüz. Eski bir taş duvarın önünde duran büyük bir yaprak yığını gibi
> görünürlerdi. Talha iki dalı yana çekiyor. Top görünmüyor. Lara eğilip bakıyor.

Yönlendirme: `Koşarken canlı başla; tanıdık yer tuhaflaşmaya başladığında yavaşla.`

### `intro-08` · Lara

> Daha içeri gitmiş.

Ek yönlendirme yok; Lara profili yeterlidir.

### `intro-09` · Anlatıcı

> Sen de birkaç dalı yana itiyorsun. Ve o anda garip bir şey fark ediyorsun.
> Çalıların arkası düşündüğünden çok daha derin. Hatta orada bir geçit var.

Yönlendirme: `Keşfi yavaşça kur; çok daha derin sözünü vurgula ve son cümleden önce kısa bir merak duraklaması bırak.`

### `intro-10` · Mila

> Bir dakika!

Yönlendirme: `Korkuyla değil, önemli bir şey fark etmiş gibi söyle.`

## Çın Karga sahnesi — konuşmacı ayrımı

Bağlayıcı anlatı ve doğrudan konuşmalar ayrı kayıtlar olur. Böylece Çın
Karga’nın tiyatrocu üslubu Lara veya Talha’nın seslendirmesine taşınmaz.

### `intro-18` · Anlatıcı

> Eski taş duvarın üzerinden siyah bir baş uzanıyor. Bir karga. Adı Çın. Ama
> sıradan bir karga değil. Boynunda paslı küçük bir anahtar taşıyor. Gagasının
> ucunda da parlak bir metal pul var. Karga başını yana eğiyor.

Yönlendirme: `Kısa keşif duraklamaları kullan; Çın’ı gizemli ama güvenli tanıt.`

Editör notu: “Adı Çın.” kaynak metinde bulunmayan tek devamlılık ekidir. Kaynak
metin daha sonra karakteri “Çın Karga” diye adlandırdığı için burada tanıtılır.

### `intro-19` · Çın Karga

> Dört çocuk.

Yönlendirme: `Kesin bir gözlem gibi söyle ve ardından görkemli bir duraklama bırak.`

### `intro-21` · Çın Karga

> Bir top.

Yönlendirme: `Aynı ciddi sayma ritmini koru; kendinden hafifçe memnun duyul.`

### `intro-23` · Lara

> Sen… konuşabiliyor musun?

Yönlendirme: `Üç noktayı gerçek bir şaşkınlık duraklaması gibi kullan.`

### `intro-25` · Çın Karga

> Hayır.

Yönlendirme: `Tamamen ciddi ve kuru bir komedi tonuyla söyle.`

### `intro-27` · Çın Karga

> Ben opera söylüyorum.

Yönlendirme: `Bilinçli bir duraklamadan sonra görkemli ve kendini önemli gören bir şekilde söyle.`

### `intro-29` · Talha

> Ama az önce konuştun.

Yönlendirme: `Abartmadan, şaşkın ve mantıklı bir düzeltme gibi söyle.`

## Birinci seçim

Arayüzdeki kısa etiket, sesli soru ve cihazdaki eşleştirme ifadeleri farklı
amaçlara hizmet eder:

| Amaç | A seçeneği | B seçeneği |
| --- | --- | --- |
| Ekrandaki kısa etiket | Hemen patikadan ilerle | Önce girişi incele |
| Kaynak metindeki seçenek | “Bence hemen patikadan ilerleyip topumuzu bulmalıyız.” | “Bence önce girişin etrafına dikkatlice bakıp sonra patikadan ilerlemeliyiz.” |
| Cihazdaki örnek eşleşmeler | `hemen ilerleyelim`, `patikaya girelim`, `topu arayalım` | `önce etrafa bakalım`, `girişi incele`, `yosunlara bakalım` |

### `choice-01-prompt` · Anlatıcı

> Nasıl devam etmek istersin? Hemen patikadan ilerleyip topu bulmak mı, yoksa
> önce girişin etrafına dikkatlice bakmak mı?

Yönlendirme: `Sıcak ve tamamen tarafsız söyle. Yoksa sözcüğünden önce belirgin bir duraklama bırak; seçeneklerden birini daha hevesli okuma.`

### `choice-01-guidance` · Anlatıcı

> İki seçenekten birini söyleyebilir veya ekrandaki seçeneğe dokunabilirsin.

Yönlendirme: `Kısa, sabırlı ve destekleyici söyle; düzeltme yapıyormuş gibi konuşma.`

Eşleştirme ifadeleri cihazda yazılı veri olarak kalır; seslendirilmez.

## A kolu — örnek kayıtlar

### `choice-01-a-01` · Anlatıcı

> Önden yürümeye başlıyorsun. Dallar kollarına hafifçe değiyor. Lara, Talha ve
> Neva arkandan geliyor. Birkaç adım sonra ayağın bir şeye çarpıyor. Pof! Top!

Yönlendirme: `İlerleme duygusuyla başla; top bulunduğunda eğlenceli bir şaşkınlık yarat.`

### `choice-01-a-02` · Mila

> Buldum!

Yönlendirme: `Kendiliğinden gelen mutlu bir başarı tepkisi.`

### `choice-01-a-03` · Anlatıcı

> Topu alırken ayağının altından metal bir ses geliyor. TANG! Hepiniz
> sıçrıyorsunuz. Toprağa yarı gömülmüş eski bir metal levhaya basmışsın.
> Üzerindeki yazılar silinmiş. Ama üç şekil hâlâ görünüyor. Bir güneş. Bir ay.
> Bir yıldız.

Yönlendirme: `Metal sesini keskin ama korkutmayacak şekilde canlandır; üç sembolü akılda kalması için yavaş ve ayrı söyle.`

## B kolu — örnek kayıtlar

### `choice-01-b-01` · Anlatıcı

> Girişin çevresini dikkatlice inceliyorsun. Yosunların arasında düz bir şey
> görüyorsun. Elinle yosunu temizliyorsun. Altından küçük bir metal levha
> çıkıyor. Üzerindeki yazılar silinmiş. Ama üç sembol hâlâ görünüyor. Bir güneş.
> Bir ay. Bir yıldız.

Yönlendirme: `Sessiz bir gözlemle başla ve tatmin edici bir keşfe dönüş; üç sembolü yavaş ve ayrı söyle.`

### `choice-01-b-02` · Çın Karga

> Üç!

Yönlendirme: `Yukarıdan gelen ani ve tiyatrocu bir müdahale; komik ol ama korkutma.`

### `choice-01-b-03` · Lara

> Gerçekten çok tuhaf bir karga.

Yönlendirme: `Çın’ı sevmeye başlamış gibi eğlenerek söyle.`

## Ortak anlatı ve durma noktası

### `shared-01` · Anlatıcı

> Topunuzu buldunuz. Aslında artık eve dönebilirsiniz. Ama hiç kimse dönmek
> istemiyor. Çünkü patika önünüzde devam ediyor. Taşların üzerine küçük oklar
> çizilmiş. Eski duvarın bazı yerlerini sarmaşıklar kaplamış. En tuhafı ise şu:
> Birkaç adım ilerleyince mahallenin sesleri yavaş yavaş kayboluyor.

Yönlendirme: `Sıcak bir başarı duygusundan meraka geç; mahallenin sesleri kaybolurken anlatımı yavaşça yumuşat.`

### `shared-02` · Anlatıcı

> Arabalar duyulmuyor. İnsan sesleri yok. Sadece kuşlar… Rüzgâr… Ve
> yaprakların sesi. Neva sarı güneş taşını hâlâ elinde tutuyor.

Yönlendirme: `Ferah ve duyusal anlat; geriye kalan her sese nefes alacak alan bırak.`

### `shared-03` · Anlatıcı

> Biraz sonra yol ikiye ayrılıyor. Sağ tarafta düz taşlar var. Taşların üzerinde
> ok işaretleri görülüyor. Sol tarafta ise ağaçlara bağlanmış mavi kurdeleler
> sallanıyor. Tam karar vermeye çalışırken yukarıdan ince bir ses geliyor.

Yönlendirme: `İki yolun konumunu net anlat; görünmeyen ses geldiğinde enerjiyi yükselt.`

Bay Makara’nın bağlayıcı anlatısı ile sözleri de ayrı kayıtlara bölünür. Son
kayıt şöyledir:

### `shared-26` · Bay Makara

> Birini seçin.

Yönlendirme: `Neşeli bir meydan okuma ve bir sonraki seçime davet gibi söyle.`

Bu kayıt bittiğinde oynanabilir test bölümü tamamlanır. “Taşlardaki okları izle”
ve “Mavi kurdeleleri izle” seçenekleri henüz ekranda gösterilmez.

## İlk ses üretim denemesi

Tam 86 kayıt üretilmeden önce aşağıdaki 10 kayıtla sınırlı bir kalite denemesi
yapılır:

| Kayıtlar | Kontrol edilen özellik |
| --- | --- |
| `intro-01`–`intro-06` | Art arda çalınan anlatıcı, Lara ve Talha kayıtları; kısa ve uzun metin; yönlendirmeli ve yönlendirmesiz okuma; “Pof!” ses efekti |
| `intro-10` | Dinleyicinin temsilcisi Mila’nın doğal ve hafif karakterlendirilmiş sesi |
| `intro-27` | Çın Karga’nın tiyatrocu ve kuru komedi tonu |
| `choice-01-prompt` | İki seçenek arasında tarafsız ton ve anlaşılır duraklama |
| `shared-13` | Bay Makara’nın kendini önemli gören konferans üslubu |

Neva’nın bu bölümde doğrudan konuşması bulunmadığı için ilk ses denemesinde
ayrı bir Neva kaydı yoktur. Bu 10 kayıt onaylandıktan sonra aynı üretim sistemi
kalan 76 kaydı oluşturur.
