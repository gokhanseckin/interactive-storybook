import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Store } from "./store.ts";
import { Media } from "./media.ts";
import { Platform } from "./platform.ts";
import { StorySchema, segments } from "@story/contracts";
import type { Actor } from "./auth.ts";
const root = process.env.DATA_DIR ?? ".data/development";
if (process.env.APP_ENV === "production")
  throw new Error("Development fixtures must not seed production");
const store = new Store(join(root, "content.sqlite"));
const user = store.one("SELECT * FROM users LIMIT 1");
if (!user) throw new Error("Provision a local user first");
const actor: Actor = { id: user.id, email: user.email, roles: ["admin"] };
const platform = new Platform(store, new Media(join(root, "media")));
const source = JSON.parse(
  await readFile(
    new URL(
      "../../../apps/mobile/src/domain/hiddenGardenStory.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const map: Record<string, string> = {
  "01-section-one": "01-section-one.mp3",
  "02-decision-question": "02-decision-question.mp3",
  "03-option-a": "03-option-a.mp3",
  "04-option-b": "04-option-b.mp3",
  "05-section-two": "05-section-two.mp3",
  "06-optional-reminder": "06-optional-reminder.mp3",
};
for (let index = 0; index < 6; index++) {
  const title = index === 0 ? source.title : `Development fixture ${index + 1}`;
  if (
    store
      .all("SELECT data FROM stories")
      .some((r) => JSON.parse(r.data).story.title === title)
  )
    continue;
  const story = StorySchema.parse({ ...source, title });
  let draft = platform.create(
    actor,
    story,
    index === 0 ? source.id : undefined,
  );
  draft = platform.mutate(actor, draft.id, draft.revision, (d) => {
    d.card.description =
      index === 0
        ? "Mila ve arkadaşlarıyla gizli bahçeyi keşfet."
        : "Development verification fixture. Reuses approved narration; not a new editorial story.";
  });
  if (index === 4) {
    draft.visibility = "coming-soon";
    platform.save(draft);
    continue;
  }
  if (index === 5) continue;
  for (const s of segments(story)) {
    const filename = map[s.audioKey?.split("/").at(-1) ?? ""];
    if (!filename) throw new Error(`Missing recording mapping: ${s.id}`);
    const data = await readFile(
      new URL(
        `../../../apps/mobile/assets/audio/calilarin-ardindaki-gizli-bahce-test-elevenlabs-v1/tr-TR/${filename}`,
        import.meta.url,
      ),
    );
    const asset = await platform.media.put(data, "audio/mpeg");
    store.run(
      "INSERT OR IGNORE INTO assets VALUES(?,?,?)",
      asset.id,
      JSON.stringify(asset),
      Date.now(),
    );
    draft = platform.attach(actor, draft.id, draft.revision, s.id, asset);
  }
  draft.preview = { revision: draft.revision, actor: actor.id };
  platform.save(draft);
  platform.review(actor, draft.id, draft.revision);
  const release =
    index === 0
      ? platform.manifest(draft, "bundled-garden-elevenlabs-v1")
      : await platform.candidate(actor, draft.id, draft.revision);
  if (index === 0)
    store.run(
      "INSERT INTO releases VALUES(?,?,?)",
      release.releaseId,
      draft.id,
      JSON.stringify(release),
    );
  await platform.activate(actor, release.releaseId);
  if (index === 3) {
    draft = platform.mutate(actor, draft.id, draft.revision, (d) => {
      d.story.episode.title += " (revised)";
    });
    draft.preview = { revision: draft.revision, actor: actor.id };
    platform.save(draft);
    platform.review(actor, draft.id, draft.revision);
    const update = await platform.candidate(actor, draft.id, draft.revision);
    await platform.activate(actor, update.releaseId);
  }
}
console.log(
  "Seeded four playable development books, one coming-soon card, one incomplete draft. No narration generated.",
);
