import { useEffect, useState } from "react";
import {
  BackHandler,
  AppState,
  Alert,
  ImageBackground,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { catalog, manifest, API } from "../delivery/client";
import { downloads } from "../delivery/native";
import { sampleStory } from "../domain/sampleStory";
import { DownloadsScreen } from "./DownloadsScreen";
import type { Manifest } from "@story/contracts";

const colors = {
  paper: "#F5F3FA",
  ink: "#302640",
  muted: "#756C82",
  purple: "#695091",
  line: "#DFDAE8",
  green: "#214F43",
  yellow: "#F6D98B",
};
const serif = Platform.OS === "ios" ? "Georgia" : "serif";
type Book = {
  id: string;
  title: string;
  age: string;
  genre: string;
  available: boolean;
  plot: string;
  names: string;
  caption: string;
  releaseId?: string;
  locale: string;
  cover?: string;
};
const welcome: Book = {
  id: sampleStory.id,
  title: sampleStory.title,
  age: "6–8 yaş",
  genre: "Kısa karşılama masalı",
  available: true,
  plot: "Mila ve arkadaşlarıyla gümüş yaprağı bul. İki yolu da keşfedebileceğin kısa bir karşılama masalı.",
  names: "Mila, Lara, Talha ve Neva",
  caption: "İnternetsiz dinlenebilen kısa bir macera.",
  locale: "tr-TR",
};

function BookCover({ book, large = false }: { book: Book; large?: boolean }) {
  const contents = (
    <>
      <View style={s.spine} />
      <Text style={[s.coverSeries, large && { fontSize: 10 }]}>Masal Yolu</Text>
      <Text style={[s.coverTitle, large && { fontSize: 27, lineHeight: 32 }]}>
        {book.title}
      </Text>
      <Text style={s.coverFoot}>Birlikte dinle, birlikte keşfet.</Text>
    </>
  );
  return (
    <View
      accessible={false}
      style={[
        s.cover,
        large && s.coverLarge,
        book.id === "kite" && { backgroundColor: "#BCD9E8" },
      ]}
    >
      <ImageBackground
        source={
          book.cover
            ? { uri: book.cover }
            : book.id !== sampleStory.id
              ? require("../../assets/covers/hidden-garden.png")
              : require("../../assets/covers/hidden-kite.png")
        }
        style={s.coverImage}
      >
        {contents}
      </ImageBackground>
    </View>
  );
}

export function LibraryScreen({
  onListen,
  onPreview,
}: {
  onPreview?: (m: Manifest) => void;
  onListen: (storyId: string, releaseId?: string, locale?: string) => void;
}) {
  const [book, setBook] = useState<Book | null>(null);
  const [books, setBooks] = useState<Book[]>([welcome]);
  const [showDownloads, setShowDownloads] = useState(false);
  const [detail, setDetail] = useState<Manifest | null>(null);
  const [detailError, setDetailError] = useState("");
  useEffect(() => {
    let mounted = true;
    const refresh = () =>
      catalog().then((entries) => {
        if (!mounted) return;
        setBooks([
          welcome,
          ...entries.flatMap((e) => {
            const locales = Object.keys(e.releases);
            return (locales.length ? locales : ["tr-TR"]).map((locale) => ({
              id: e.id,
              title: e.card.title,
              age: e.card.ageBand.replace("-", "–") + " yaş",
              genre: locale,
              available: e.visibility === "available",
              plot: e.card.description,
              names: "",
              caption:
                e.visibility === "coming-soon"
                  ? "Yeni maceramız hazırlanıyor"
                  : e.card.description,
              releaseId: e.releases[locale],
              locale,
              cover: e.card.cover
                ? API + "/api/covers/" + e.card.cover
                : undefined,
            }));
          }),
        ]);
      });
    void refresh();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  useEffect(() => {
    setDetail(null);
    setDetailError("");
    let mounted = true;
    if (book?.releaseId)
      manifest(book.releaseId)
        .then((m) => {
          if (mounted) setDetail(m);
        })
        .catch(() => {
          if (mounted)
            setDetailError(
              "Bu sürüm açılamadı. Bağlantıyı kontrol edin veya uygulamayı güncelleyin.",
            );
        });
    return () => {
      mounted = false;
    };
  }, [book]);
  const [premium, setPremium] = useState(false);
  const [filter, setFilter] = useState("Tümü");
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (premium) {
          setPremium(false);
          return true;
        }
        if (book) {
          setBook(null);
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [book, premium]);
  if (showDownloads)
    return (
      <DownloadsScreen
        onPreview={onPreview}
        onBack={() => setShowDownloads(false)}
      />
    );
  const visible =
    filter === "Tümü" ? books : books.filter((item) => item.age === filter);
  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      {book ? (
        <>
          <View style={s.detailNav}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kitaplığa dön"
              onPress={() => setBook(null)}
              style={s.back}
            >
              <Text style={s.backText}>‹</Text>
            </Pressable>
            <Text style={s.navTitle}>Masalın içinde</Text>
            <View style={{ width: 44 }} />
          </View>
          <ScrollView
            contentContainerStyle={s.detailContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={s.coverStage}>
              <View style={s.coverHalo} />
              <BookCover book={book} large />
            </View>
            <Text style={s.detailTitle}>{book.title.replace("\n", " ")}</Text>
            <Text style={s.detailCaption}>{book.caption}</Text>
            <View style={s.facts}>
              <Fact value={book.age} label="Dinleyici yaşı" />
              <View style={s.factDivider} />
              <Fact
                value={
                  detail
                    ? `${Math.ceil(Object.values(detail.audio).reduce((n, a) => n + a.duration, 0) / 60)} dakika`
                    : book.id === welcome.id
                      ? "1 dakika"
                      : "Yakında"
                }
                label={book.available ? "Sesli macera" : "Yeni masal"}
              />
              <View style={s.factDivider} />
              <Fact value={book.locale} label="Sesli masal" />
            </View>
            <Text style={s.sectionTitle}>Seni neler bekliyor?</Text>
            <Text style={s.plot}>{book.plot}</Text>
            {!!detailError && <Text style={s.note}>{detailError}</Text>}
            {detail && (
              <Pressable
                accessibilityRole="button"
                style={s.customButton}
                onPress={() =>
                  downloads()
                    .then((q) => {
                      q.add(detail, true);
                      Alert.alert(
                        "İndirme eklendi",
                        `${(Object.values(detail.audio).reduce((n, a) => n + a.bytes, 0) / 1048576).toFixed(1)} MB. Wi-Fi dışında indirme iznini depolama ekranından değiştirebilirsiniz.`,
                      );
                    })
                    .catch((e) => Alert.alert("İndirme", e.message))
                }
              >
                <Text style={s.customButtonText}>
                  Çevrimdışı dinlemek için indir
                </Text>
              </Pressable>
            )}
            <Pressable
              style={s.customButton}
              onPress={() => setShowDownloads(true)}
            >
              <Text style={s.customButtonText}>İndirilenler ve depolama</Text>
            </Pressable>
            {book.available && (
              <Text style={s.note}>
                Bu kısa macerada bir seçim senin. İki farklı yoldan aynı keşfe
                ulaşabilirsin.
              </Text>
            )}
            <View style={s.personalCard}>
              <View style={s.personalHeader}>
                <Text style={s.personalTitle}>Bu masal sizin olsun</Text>
                <Text style={s.premiumTag}>Premium</Text>
              </View>
              <Text style={s.personalCopy}>
                Kahramanlar tanıdık isimlerle seslensin. Aylık Premium ile her
                ay 1 masalın isimlerini kişiselleştir.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPremium(true)}
                style={s.customButton}
              >
                <Text style={s.customButtonText}>İsimleri kişiselleştir</Text>
                <Text style={s.customButtonText}>✧</Text>
              </Pressable>
            </View>
            <Text style={s.defaultNote}>
              Ücretsiz sürümde kahramanların isimleri: {book.names}.
            </Text>
          </ScrollView>
          <View style={s.listenDock}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setPremium(true)}
              style={s.dockCustomize}
            >
              <Text style={s.customButtonText}>✧ İsimleri kişiselleştir</Text>
              <Text style={s.premiumTag}>Premium</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!book.available || (!!book.releaseId && !detail)}
              accessibilityState={{ disabled: !book.available }}
              onPress={() => onListen(book.id, book.releaseId, book.locale)}
              style={[
                s.listenButton,
                !book.available && { backgroundColor: "#ACA4B6" },
              ]}
            >
              <Text style={s.listenButtonText}>
                {book.available ? "▶   Dinlemeye başla" : "Çok yakında"}
              </Text>
            </Pressable>
            <Text style={s.dockCaption}>
              {book.available
                ? "Varsayılan isimlerle ücretsiz dinle"
                : "Yeni maceramız hazırlanıyor"}
            </Text>
          </View>
        </>
      ) : (
        <>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.homeContent}
          >
            <View style={s.header}>
              <View style={s.brand}>
                <View style={s.logo}>
                  <View style={s.logoPage} />
                  <View
                    style={[s.logoPage, { transform: [{ rotate: "12deg" }] }]}
                  />
                </View>
                <Text style={s.brandName}>masal yolu</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="İndirilenler ve depolama"
                onPress={() => setShowDownloads(true)}
                style={s.profile}
              >
                <Text style={s.profileIcon}>E</Text>
              </Pressable>
            </View>
            <Text style={s.homeTitle}>
              {"Bugün hangi masala\nyolculuk edelim?"}
            </Text>
            <Text style={s.homeSubtitle}>
              Bir kitap seç. Gözlerini kapat. Maceraya katıl.
            </Text>
            <View style={s.libraryHeading}>
              <Text style={s.sectionTitle}>Masal kitaplığın</Text>
              <Text style={s.count}>{books.length} masal</Text>
            </View>
            <View style={s.filters}>
              {["Tümü", "6–8 yaş", "8–10 yaş"].map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === value }}
                  onPress={() => setFilter(value)}
                  style={[s.filter, filter === value && s.filterActive]}
                >
                  <Text
                    style={[
                      s.filterText,
                      filter === value && s.filterTextActive,
                    ]}
                  >
                    {value}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={s.books}>
              {visible.map((item) => (
                <Pressable
                  key={item.id + item.locale}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title.replace("\n", " ")}, ${item.age}, ${item.available ? "ücretsiz dinle" : "yakında"}. Detayları aç.`}
                  onPress={() => setBook(item)}
                  style={s.bookCard}
                >
                  <BookCover book={item} />
                  <View style={s.bookMeta}>
                    <Text style={s.bookAge}>{item.age}</Text>
                    <Text
                      style={[
                        s.availability,
                        !item.available && { color: colors.muted },
                      ]}
                    >
                      {item.available ? "Ücretsiz" : "Yakında"}
                    </Text>
                  </View>
                  <Text style={s.bookName}>
                    {item.title.replace("\n", " ")}
                  </Text>
                  <Text style={s.genre}>{item.genre}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setPremium(true)}
              style={s.premiumBanner}
            >
              <View style={s.starTile}>
                <Text style={s.star}>✧</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.bannerTitle}>Masalın kahramanı siz olun</Text>
                <Text style={s.bannerCopy}>
                  {
                    "Premium ile her ay 1 masalda\nisimleri size özel değiştirelim."
                  }
                </Text>
                <Text style={s.bannerLink}>Premium’u keşfet ›</Text>
              </View>
            </Pressable>
            <View style={s.footerNote}>
              <Text style={s.footerSymbol}>♧</Text>
              <Text style={s.footerText}>Ekrana değil, hayallere dalın.</Text>
            </View>
          </ScrollView>
          <View style={s.bottomBar}>
            <View style={s.bottomMark} />
            <Text style={s.bottomTitle}>Kitaplık</Text>
            <Text style={s.bottomDescription}>Bir sonraki maceran burada.</Text>
          </View>
        </>
      )}
      <Modal
        visible={premium}
        transparent
        animationType="slide"
        onRequestClose={() => setPremium(false)}
      >
        <View style={s.scrim}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Premium penceresini kapat"
            onPress={() => setPremium(false)}
          />
          <ScrollView
            accessibilityViewIsModal
            style={s.sheet}
            contentContainerStyle={{ paddingBottom: 35 }}
            bounces={false}
          >
            <View style={s.sheetHandle} />
            <View style={s.sheetTop}>
              <Text style={s.premiumTag}>Masal Yolu Premium</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kapat"
                onPress={() => setPremium(false)}
                style={s.close}
              >
                <Text style={{ fontSize: 23, color: colors.ink }}>×</Text>
              </Pressable>
            </View>
            <Text style={s.sheetTitle}>
              {"Tanıdık isimler.\nYepyeni bir sihir."}
            </Text>
            <Text style={s.sheetCopy}>
              Kendi ismini bir masalda duymanın heyecanı bambaşka.
            </Text>
            <View style={s.allowance}>
              <Text style={s.allowanceNumber}>1</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.allowanceTitle}>masal / ay</Text>
                <Text style={s.allowanceCopy}>İsim kişiselleştirme hakkı</Text>
              </View>
              <Text style={s.star}>✧</Text>
            </View>
            <Text style={s.sheetCopy}>
              Aylık abonelikle her ay seçtiğin 1 masalın karakter isimlerini
              değiştirebilirsin. Standart isimlerle dinlemek her zaman ücretsiz.
            </Text>
            <View style={s.soonNotice}>
              <Text style={s.soonTitle}>Premium yakında</Text>
              <Text style={s.soonCopy}>
                Abonelik ve kişiye özel sesli masallar henüz kullanıma açılmadı.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setPremium(false)}
              style={s.listenButton}
            >
              <Text style={s.listenButtonText}>Masallara dön</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
function Fact({ value, label }: { value: string; label: string }) {
  return (
    <View style={s.fact}>
      <Text style={s.factValue}>{value}</Text>
      <Text style={s.factLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  homeContent: { paddingHorizontal: 24, paddingBottom: 22 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 10,
    marginBottom: 32,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandName: {
    fontFamily: serif,
    fontWeight: "bold",
    fontSize: 25,
    color: colors.ink,
  },
  logo: { flexDirection: "row", gap: 2, width: 29 },
  logoPage: {
    width: 13,
    height: 23,
    borderRadius: 3,
    backgroundColor: colors.purple,
    transform: [{ rotate: "-12deg" }],
  },
  profile: {
    width: 43,
    height: 43,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  profileIcon: { fontSize: 16, fontWeight: "600", color: colors.purple },
  homeTitle: {
    fontFamily: serif,
    fontSize: 32,
    lineHeight: 39,
    color: colors.ink,
    letterSpacing: -0.9,
  },
  homeSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
    marginTop: 13,
    marginBottom: 31,
  },
  libraryHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { fontSize: 19, fontWeight: "700", color: colors.ink },
  count: { color: colors.muted, fontSize: 12 },
  filters: { flexDirection: "row", gap: 9, marginTop: 17, marginBottom: 23 },
  filter: {
    minHeight: 39,
    paddingHorizontal: 18,
    justifyContent: "center",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
  },
  filterActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  filterText: { fontSize: 13, color: colors.muted },
  filterTextActive: { color: "#FFFFFF", fontWeight: "600" },
  books: { flexDirection: "row", flexWrap: "wrap", gap: 18 },
  bookCard: { width: "47.4%" },
  cover: {
    aspectRatio: 0.66,
    width: "100%",
    borderRadius: 5,
    backgroundColor: colors.green,
    overflow: "hidden",
    shadowColor: colors.ink,
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 3, height: 6 },
  },
  coverLarge: { width: 194 },
  coverImage: { flex: 1 },
  spine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 4,
    width: 3,
    backgroundColor: "#00000020",
    zIndex: 3,
  },
  coverSeries: {
    fontFamily: serif,
    color: "#FFFFFFDB",
    fontSize: 9,
    textAlign: "center",
    marginTop: 16,
  },
  coverTitle: {
    fontFamily: serif,
    fontSize: 21,
    lineHeight: 25,
    color: "#FFF9E8",
    textAlign: "center",
    marginTop: 12,
    paddingHorizontal: 12,
    zIndex: 2,
    textShadowColor: "#173D38",
    textShadowRadius: 6,
  },
  coverFoot: {
    position: "absolute",
    bottom: 12,
    fontSize: 7,
    color: "#FFF9E8",
    textAlign: "center",
    width: "100%",
    zIndex: 2,
  },
  bookMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
  },
  bookAge: { color: colors.muted, fontSize: 11 },
  availability: { color: "#356B55", fontSize: 11, fontWeight: "600" },
  bookName: {
    color: colors.ink,
    fontFamily: serif,
    fontSize: 19,
    lineHeight: 24,
    marginTop: 7,
  },
  genre: { fontSize: 11, color: colors.muted, marginTop: 6 },
  premiumBanner: {
    flexDirection: "row",
    gap: 16,
    backgroundColor: "#E9E3F2",
    borderRadius: 20,
    padding: 20,
    marginTop: 29,
  },
  starTile: {
    width: 45,
    height: 55,
    backgroundColor: colors.yellow,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    transform: [{ rotate: "-10deg" }],
  },
  star: { color: colors.purple, fontSize: 37 },
  bannerTitle: { fontSize: 16, color: colors.ink, fontWeight: "600" },
  bannerCopy: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 6,
  },
  bannerLink: {
    color: colors.purple,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 13,
  },
  footerNote: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 22,
  },
  footerSymbol: { color: colors.muted, fontSize: 19 },
  footerText: { color: colors.muted, fontSize: 12 },
  bottomBar: {
    paddingTop: 12,
    paddingBottom: 8,
    alignItems: "center",
    borderTopWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  bottomMark: {
    width: 22,
    height: 3,
    backgroundColor: colors.purple,
    borderRadius: 3,
    marginBottom: 7,
  },
  bottomTitle: { color: colors.purple, fontSize: 12, fontWeight: "700" },
  bottomDescription: { color: colors.muted, fontSize: 10, marginTop: 4 },
  detailNav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    height: 50,
  },
  back: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  backText: { fontSize: 35, color: colors.ink },
  navTitle: { color: colors.muted, fontSize: 14 },
  detailContent: { paddingHorizontal: 25, paddingBottom: 24 },
  coverStage: { alignItems: "center", paddingTop: 20, paddingBottom: 28 },
  coverHalo: {
    position: "absolute",
    top: 57,
    width: 280,
    height: 225,
    borderRadius: 150,
    backgroundColor: "#E3E9E1",
  },
  detailTitle: {
    fontFamily: serif,
    fontSize: 29,
    lineHeight: 35,
    textAlign: "center",
    color: colors.ink,
    letterSpacing: -0.5,
  },
  detailCaption: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
    textAlign: "center",
    marginTop: 10,
  },
  facts: {
    flexDirection: "row",
    marginVertical: 27,
    paddingVertical: 19,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  fact: { flex: 1, alignItems: "center" },
  factValue: { fontSize: 15, fontWeight: "600", color: colors.ink },
  factLabel: { fontSize: 10, color: colors.muted, marginTop: 6 },
  factDivider: { width: 1, backgroundColor: colors.line },
  plot: { color: "#5E566B", fontSize: 15, lineHeight: 25, marginTop: 12 },
  note: { color: colors.muted, fontSize: 12, lineHeight: 20, marginTop: 12 },
  personalCard: {
    padding: 19,
    backgroundColor: "#E9E3F2",
    borderRadius: 16,
    marginTop: 25,
  },
  personalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  personalTitle: { fontFamily: serif, fontSize: 20, color: colors.ink },
  premiumTag: {
    color: colors.purple,
    fontSize: 11,
    fontWeight: "700",
    backgroundColor: "#F7F3FC",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  personalCopy: {
    color: "#6A6079",
    fontSize: 13,
    lineHeight: 21,
    marginTop: 11,
  },
  customButton: {
    minHeight: 47,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 15,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#BAAACF",
    marginTop: 16,
  },
  customButtonText: { fontSize: 14, fontWeight: "600", color: colors.purple },
  defaultNote: {
    fontSize: 11,
    lineHeight: 18,
    color: colors.muted,
    textAlign: "center",
    marginTop: 16,
  },
  dockCustomize: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginBottom: 6,
  },
  listenDock: {
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  listenButton: {
    minHeight: 53,
    borderRadius: 15,
    backgroundColor: colors.purple,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  listenButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  dockCaption: {
    textAlign: "center",
    color: colors.muted,
    fontSize: 11,
    paddingVertical: 10,
  },
  scrim: { flex: 1, backgroundColor: "#241C3A70", justifyContent: "flex-end" },
  sheet: {
    maxHeight: "90%",
    flexGrow: 0,
    backgroundColor: colors.paper,
    paddingHorizontal: 28,
    paddingTop: 12,
    paddingBottom: 40,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
  },
  sheetHandle: {
    width: 35,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    alignSelf: "center",
    marginBottom: 18,
  },
  sheetTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTitle: {
    color: colors.ink,
    fontFamily: serif,
    fontSize: 32,
    lineHeight: 39,
    marginTop: 15,
  },
  sheetCopy: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 23,
    marginTop: 13,
  },
  allowance: {
    flexDirection: "row",
    gap: 17,
    alignItems: "center",
    borderColor: colors.line,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 15,
    marginTop: 23,
  },
  allowanceNumber: { color: colors.purple, fontFamily: serif, fontSize: 54 },
  allowanceTitle: { fontSize: 19, fontWeight: "600", color: colors.ink },
  allowanceCopy: { color: colors.muted, fontSize: 12, marginTop: 5 },
  soonNotice: {
    marginVertical: 22,
    padding: 15,
    backgroundColor: "#ECE8F1",
    borderRadius: 12,
  },
  soonTitle: { color: colors.ink, fontWeight: "600", fontSize: 13 },
  soonCopy: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 5 },
});
