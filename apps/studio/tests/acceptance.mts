/** Studio browser acceptance. See docs/verification/parallel/story-studio.md for invocation.
 * No provider is contacted: the Worker receives an explicit fixture generator.
 * SQLite, media, browser profiles and screenshots are isolated per run.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Store } from "../../../services/content-api/src/store.ts";
import { Media } from "../../../services/content-api/src/media.ts";
import { Platform } from "../../../services/content-api/src/platform.ts";
import { createApp } from "../../../services/content-api/src/app.ts";
import { passwordHash } from "../../../services/content-api/src/auth.ts";
import { Worker } from "../../../services/content-api/src/worker.ts";
const requireBrowser = createRequire(
  resolve(process.env.STUDIO_BROWSER_TOOLS || ".", "package.json"),
);
const { chromium } = requireBrowser("playwright");
const directory = await mkdtemp(join(tmpdir(), "studio-acceptance-"));
const store = new Store(join(directory, "content.sqlite"));
const platform = new Platform(store, new Media(join(directory, "media")));
const port = Number(process.env.STUDIO_TEST_PORT || 4493);
const origin = `http://127.0.0.1:${port}`;
const app = createApp(platform, {
  origin,
  secret: "local-studio-test-secret-never-for-production",
});
const password = "local-browser-acceptance-only";
const accounts = [
  { id: "author", roles: ["creator"] },
  { id: "editor", roles: ["creator"] },
  { id: "publisher", roles: ["publisher"] },
  { id: "outsider", roles: ["creator", "publisher"] },
];
for (const a of accounts)
  store.run(
    "INSERT INTO users VALUES(?,?,?,?)",
    a.id,
    `${a.id}@example.test`,
    passwordHash(password),
    JSON.stringify(a.roles),
  );
const mp3 = await readFile(
  new URL(
    "../../../services/content-api/fixtures/reminder.mp3",
    import.meta.url,
  ),
);
let generatorCalls = 0;
const worker = new Worker(platform, async () => {
  generatorCalls++;
  return { audio: mp3, requestId: "mock-only" };
});
await app.listen({ port, host: "127.0.0.1" });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.STUDIO_CHROMIUM
    ? { executablePath: process.env.STUDIO_CHROMIUM }
    : {}),
});
const failures: string[] = [];
const contexts: any[] = [];
const checks: string[] = [];
const pass = (message: string) => {
  checks.push(message);
  console.log(`PASS ${message}`);
};
async function signedIn(account: string, timeZone = "Europe/Istanbul") {
  const context = await browser.newContext({ timezoneId: timeZone });
  contexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", (e: Error) => failures.push(e.message));
  page.on("dialog", (dialog: any) => dialog.accept());
  await page.goto(origin);
  await page
    .getByLabel("Email", { exact: true })
    .fill(`${account}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "Your story library" }).waitFor();
  return page;
}
async function click(page: any, name: string) {
  await page.getByRole("button", { name, exact: true }).first().click();
  await page.waitForFunction(
    () => !document.querySelector("#app")?.hasAttribute("inert"),
  );
}
async function text(page: any, selector: string, pattern: RegExp) {
  await page.waitForFunction(
    ({ selector, source, flags }: any) =>
      new RegExp(source, flags).test(
        document.querySelector(selector)?.textContent || "",
      ),
    { selector, source: pattern.source, flags: pattern.flags },
  );
}
async function api(
  page: any,
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  return page.evaluate(
    async ({ path, body, method }: any) => {
      const response = await fetch("/api" + path, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: await response.json() };
    },
    { path, body, method },
  );
}
async function reload(page: any) {
  await click(page, "Reload latest revision");
}
async function uploadClip(page: any) {
  await page.getByLabel("Upload MP3", { exact: true }).first().setInputFiles({
    name: "approved-reminder.mp3",
    mimeType: "audio/mpeg",
    buffer: mp3,
  });
  await text(page, "#notice", /Upload validated/);
}
async function freeze(page: any) {
  await click(page, "Preview");
  await click(page, "Load preview");
  await click(page, "Mark revision previewed");
  await click(page, "Review & publish");
  await click(page, "Approve previewed revision");
  await click(page, "Freeze release candidate");
}
try {
  const author = await signedIn("author");
  await click(author, "New story");
  await author
    .getByLabel("Title", { exact: true })
    .fill("Studio browser story");
  await author
    .getByLabel("Description", { exact: true })
    .fill("Approved audio reused solely as a local workflow fixture.");
  await click(author, "Content");
  await click(author, "Details");
  assert.equal(
    await author.getByLabel("Title", { exact: true }).inputValue(),
    "Studio browser story",
  );
  await text(author, "#edit-status", /Unsaved changes/);
  author.removeAllListeners("dialog");
  author.on("dialog", (d: any) => d.dismiss());
  await click(author, "Back to library");
  assert.equal(
    await author.getByRole("heading", { name: "Story details" }).count(),
    1,
  );
  author.removeAllListeners("dialog");
  author.on("dialog", (d: any) => d.accept());
  await click(author, "Save details");
  await text(author, "#notice", /Draft saved/);
  await author.getByLabel("Upload cover").setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO9sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await text(author, "#notice", /Upload validated/);
  const storyId = (await api(author, "/stories")).data[0].id;
  pass("draft creation, editing, tab retention and cancelled discard");

  await click(author, "Review & publish");
  assert.equal(
    await author
      .getByRole("button", { name: "Approve previewed revision" })
      .isDisabled(),
    true,
  );
  await click(author, "audio.clip-1: Missing MP3");
  assert.equal(
    await author
      .locator('[data-path="audio.clip-1"] input')
      .evaluate((e: Element) => e === document.activeElement),
    true,
  );
  await uploadClip(author);
  await click(author, "Listen");
  await author.waitForFunction(() => {
    const a = document.querySelector("audio");
    return a && a.currentTime > 0;
  });
  pass(
    "missing asset validation focuses upload; binary upload, measured readiness and actual browser audition",
  );

  await click(author, "Content");
  await author.getByLabel("Next scene (empty ends narration)").fill("missing");
  await click(author, "Save content");
  await text(author, "#notice", /Next node does not exist/);
  await click(author, "nodes.scene-1.nextNodeId: Next node does not exist.");
  assert.equal(
    await author
      .getByLabel("Next scene (empty ends narration)")
      .evaluate((e: Element) => e === document.activeElement),
    true,
  );
  await author.getByLabel("Next scene (empty ends narration)").fill("");
  await author.getByLabel("Spoken text").fill("");
  await click(author, "Save content");
  await text(author, "#notice", /nodes.scene-1.segments.0.text/);
  await author.locator("#notice button").first().click();
  assert.equal(
    await author
      .getByLabel("Spoken text")
      .evaluate((e: Element) => e === document.activeElement),
    true,
  );
  await reload(author);
  await author.getByLabel("Story JSON").fill("{broken");
  await click(author, "Details");
  await click(author, "Content");
  assert.equal(await author.getByLabel("Story JSON").inputValue(), "{broken");
  await click(author, "Import JSON into editor");
  await text(author, "#notice", /JSON|Expected/);
  await click(author, "Discard JSON changes");
  pass("graph/field validation navigation and malformed JSON recovery");

  // Grant editor access in fixture setup only; the production API remains unmodified.
  const d = platform.get(storyId);
  d.editors = ["editor"];
  platform.save(d);
  const editor = await signedIn("editor");
  await click(editor, "Open story");
  await click(author, "Details");
  await author.getByLabel("Title", { exact: true }).fill("Local unsaved title");
  await editor.getByLabel("Title", { exact: true }).fill("Editor won");
  await click(editor, "Save details");
  await click(author, "Save details");
  await text(author, "#notice", /local edits are preserved/);
  assert.equal(
    await author.getByLabel("Title", { exact: true }).inputValue(),
    "Local unsaved title",
  );
  assert.equal(platform.get(storyId).story.title, "Editor won");
  await reload(author);
  assert.equal(
    await author.getByLabel("Title", { exact: true }).inputValue(),
    "Editor won",
  );
  pass(
    "shared creator editor, stale-save conflict, preservation and explicit reload",
  );

  const publisher = await signedIn("publisher");
  assert.equal(
    await publisher.getByRole("button", { name: "New story" }).count(),
    0,
  );
  await click(publisher, "Open story");
  assert.equal(
    await publisher.getByLabel("Title", { exact: true }).isDisabled(),
    true,
  );
  let latest = platform.get(storyId);
  assert.equal(
    (
      await api(
        publisher,
        `/stories/${storyId}`,
        { revision: latest.revision, story: latest.story },
        "PUT",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api(author, `/stories/${storyId}/review`, {
        revision: latest.revision,
      })
    ).status,
    403,
  );
  const outsider = await signedIn("outsider");
  await click(outsider, "Open story");
  assert.equal(
    await outsider.getByLabel("Title", { exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    (
      await api(
        outsider,
        `/stories/${storyId}`,
        { revision: latest.revision, story: latest.story },
        "PUT",
      )
    ).status,
    403,
  );
  pass(
    "author/editor/publisher and combined-role outsider UI plus authoritative API permission boundaries",
  );

  await click(publisher, "Catalog");
  await click(publisher, "coming-soon");
  assert.equal(platform.get(storyId).visibility, "coming-soon");
  await freeze(publisher);
  let releases = (await api(publisher, `/stories/${storyId}`)).data.releases;
  const firstRelease = releases[0];
  await click(publisher, "Publish / roll back to this release");
  assert.equal(platform.get(storyId).active["tr-TR"], firstRelease.releaseId);
  await click(author, "Content");
  await author.getByLabel("Spoken text").fill("A revised narration.");
  await click(author, "Save content");
  assert.equal(platform.get(storyId).review, null);
  assert.equal(platform.get(storyId).preview, null);
  assert.equal(platform.get(storyId).active["tr-TR"], firstRelease.releaseId);
  await click(author, "Audio");
  await text(author, "#app", /Audio is stale/);
  await uploadClip(author);
  await reload(publisher);
  await freeze(publisher);
  releases = (await api(publisher, `/stories/${storyId}`)).data.releases;
  const secondRelease = releases.find(
    (m: any) => m.releaseId !== firstRelease.releaseId,
  );
  await publisher
    .getByRole("button", {
      name: "Publish / roll back to this release",
      exact: true,
    })
    .nth(1)
    .click();
  await publisher.waitForFunction(
    () => !document.querySelector("#app")?.hasAttribute("inert"),
  );
  assert.equal(platform.get(storyId).active["tr-TR"], secondRelease.releaseId);
  await click(publisher, "Publish / roll back to this release");
  assert.equal(platform.get(storyId).active["tr-TR"], firstRelease.releaseId);
  assert.equal(
    platform.release(firstRelease.releaseId).story.nodes["scene-1"].segments[0]
      .text,
    "Once upon a time…",
  );
  pass(
    "preview acknowledgment, review, immutable publication, review invalidation, replacement and rollback",
  );

  const schedule = publisher
    .getByLabel("Schedule date and time (Europe/Istanbul)", { exact: true })
    .first();
  await schedule.fill("2020-01-01T10:00");
  await click(publisher, "Schedule release");
  await text(publisher, "#notice", /future/);
  const scheduleKeys: string[] = [];
  let loseSchedule = true;
  await publisher.route("**/api/releases/*/schedule", async (route: any) => {
    scheduleKeys.push(route.request().postDataJSON().key);
    if (loseSchedule) {
      loseSchedule = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await schedule.fill("2030-01-15T10:00");
  await click(publisher, "Schedule release");
  await text(publisher, "#notice", /fetch/i);
  await click(publisher, "Schedule release");
  assert.equal(scheduleKeys.length, 2);
  assert.equal(scheduleKeys[0], scheduleKeys[1]);
  await publisher.unroute("**/api/releases/*/schedule");
  let publications = store.all("SELECT * FROM publications");
  assert.equal(publications.length, 1);
  assert.equal(
    new Date(publications[0].due).toISOString(),
    "2030-01-15T07:00:00.000Z",
  );
  await text(publisher, "#app", /UTC: 2030-01-15T07:00/);
  await click(publisher, "Cancel schedule");
  await publisher
    .getByLabel("Schedule date and time (Europe/Istanbul)", { exact: true })
    .first()
    .fill("2030-01-15T10:00");
  await click(publisher, "Schedule release");
  publications = store.all("SELECT * FROM publications");
  assert.equal(publications.length, 2);
  assert.equal(
    publications.filter((p: any) => p.state === "scheduled").length,
    1,
  );
  store.run("UPDATE publications SET due=0 WHERE state='scheduled'");
  await worker.publishDue();
  await reload(publisher);
  await text(publisher, "#app", /published ·/);
  pass(
    "schedule validation, Istanbul/UTC instant, cancellation, same-time reschedule and worker activation",
  );

  await click(publisher, "Catalog");
  await click(publisher, "hidden");
  assert.equal((await api(publisher, "/catalog")).data.length, 0);
  assert.equal(
    (await api(publisher, `/releases/${firstRelease.releaseId}`)).status,
    200,
  );
  await click(publisher, "Withdraw new online playback");
  assert.equal(
    (await api(publisher, `/releases/${firstRelease.releaseId}`)).status,
    403,
  );
  await click(publisher, "Restore online access");
  pass(
    "independent visibility and withdrawal with historical release retention",
  );

  await reload(author);
  await click(author, "Audio");
  const keys: string[] = [];
  let loseResponse = true;
  await author.route("**/api/stories/*/jobs", async (route: any) => {
    keys.push(route.request().postDataJSON().key);
    if (loseResponse) {
      loseResponse = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await click(author, "Generate with elevenlabs");
  await text(author, "#notice", /fetch/i);
  await click(author, "Generate with elevenlabs");
  await author.reload();
  await click(author, "Open story");
  await click(author, "Audio");
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(store.all("SELECT * FROM jobs").length, 1);
  assert.equal(
    await author
      .getByRole("button", { name: "Generate with elevenlabs" })
      .isDisabled(),
    true,
  );
  await worker.tick();
  await click(author, "Refresh queue");
  assert.equal(generatorCalls, 1);
  await text(author, "#app", /elevenlabs: complete/);
  await author.unroute("**/api/stories/*/jobs");
  await click(author, "Generate with openai");
  const queued = JSON.parse(
    store.one("SELECT data FROM jobs WHERE state='queued'").data,
  );
  queued.state = "uncertain";
  queued.error = "Mock lost provider outcome; reconcile usage.";
  worker.write(queued);
  await click(author, "Refresh queue");
  await text(author, "#app", /billing is uncertain/);
  assert.equal(
    await author
      .getByRole("button", { name: "Generate with openai" })
      .isDisabled(),
    true,
  );
  assert.equal(generatorCalls, 1);
  pass(
    "lost-response generation retry reuses key, one mock invocation, queued and uncertain states block new paid attempts",
  );

  await click(author, "Details");
  await author.getByLabel("Description").fill("Unsaved description");
  await click(author, "Audio");
  await click(author, "Listen");
  await text(author, "#notice", /Save or discard/);
  await reload(author);
  const savedAsset = platform.get(storyId).clips["clip-1"].asset.id;
  await author.getByLabel("Upload MP3", { exact: true }).setInputFiles({
    name: "bad.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from("invalid"),
  });
  await text(author, "#notice", /MP3|MPEG|audio|Request failed/i);
  assert.equal(platform.get(storyId).clips["clip-1"].asset.id, savedAsset);
  pass(
    "unsaved edits block saved-revision actions; invalid upload leaves current asset intact",
  );

  // Deterministic corruption failure: activation must retain the old catalog pointer.
  const before = platform.get(storyId).active["tr-TR"];
  const assetPath = platform.media.path(firstRelease.audio["clip-1"].id);
  await writeFile(assetPath, "corrupt");
  await reload(publisher);
  await click(publisher, "Review & publish");
  await click(publisher, "Publish / roll back to this release");
  await text(publisher, "#notice", /corrupt|Request failed/i);
  assert.equal(platform.get(storyId).active["tr-TR"], before);
  const failedSchedule = await api(
    publisher,
    `/releases/${firstRelease.releaseId}/schedule`,
    {
      at: "2031-01-01T00:00:00Z",
      timeZone: "UTC",
      key: "corrupt-schedule",
    },
  );
  assert.equal(failedSchedule.status, 200);
  store.run("UPDATE publications SET due=0 WHERE id=?", failedSchedule.data.id);
  await worker.publishDue();
  await reload(publisher);
  await text(publisher, "#app", /failed ·/);
  assert.equal(platform.get(storyId).active["tr-TR"], before);
  await writeFile(assetPath, mp3);
  pass(
    "failed activation and corrupt-media schedule preserve active release and display server failure",
  );

  const ny = await signedIn("publisher", "America/New_York");
  await click(ny, "Open story");
  await click(ny, "Review & publish");
  await ny
    .getByLabel("Schedule date and time (America/New_York)", { exact: true })
    .first()
    .fill("2030-03-10T02:30");
  await click(ny, "Schedule release");
  await text(ny, "#notice", /does not exist/);
  await ny
    .getByLabel("Schedule date and time (America/New_York)", { exact: true })
    .first()
    .fill("2030-11-03T01:30");
  await click(ny, "Schedule release");
  await text(ny, "#notice", /ambiguous/);
  pass("nonexistent and ambiguous DST times rejected before submission");
  // A second story exercises branching authoring and every preview audio control.
  await click(author, "Back to library");
  await click(author, "New story");
  await click(author, "Details");
  await author
    .getByLabel("Title", { exact: true })
    .fill("Choice acceptance story");
  await author
    .getByLabel("Description")
    .fill("Local branch fixture using approved narration.");
  await click(author, "Save details");
  await click(author, "Content");
  await click(author, "Add choice");
  await author.getByLabel("Option label").first().fill("Forest path");
  await author
    .getByLabel("Voice hints (comma separated)")
    .first()
    .fill("forest, trees");
  await click(author, "Save content");
  const choiceId = (await api(author, "/stories")).data.find(
    (d: any) => d.story.title === "Choice acceptance story",
  ).id;
  const graph = platform.get(choiceId).story;
  const disconnected = structuredClone(graph);
  disconnected.nodes.orphan = {
    id: "orphan",
    kind: "narration",
    segments: [
      { id: "orphan-clip", speaker: "narrator", text: "Unreachable." },
    ],
    nextNodeId: null,
  };
  await author.getByLabel("Story JSON").fill(JSON.stringify(disconnected));
  await click(author, "Import JSON into editor");
  await click(author, "Save content");
  await text(author, "#notice", /Scene is unreachable/);
  await click(author, "nodes.orphan: Scene is unreachable.");
  assert.equal(
    await author
      .locator('[data-path="nodes.orphan"] input')
      .first()
      .evaluate((e: Element) => e === document.activeElement),
    true,
  );
  await reload(author);
  await click(author, "Audio");
  const count = await author.getByLabel("Upload MP3", { exact: true }).count();
  assert.equal(count, 6);
  for (let i = 0; i < count; i++) {
    await author
      .getByLabel("Upload MP3", { exact: true })
      .nth(i)
      .setInputFiles({
        name: "approved.mp3",
        mimeType: "audio/mpeg",
        buffer: mp3,
      });
    await text(author, "#notice", /Upload validated/);
  }
  await click(author, "Preview");
  await click(author, "Load preview");
  await click(author, "Play scene");
  await author.waitForFunction(() => {
    const a = document.querySelector("audio");
    return a && a.currentTime > 0;
  });
  await click(author, "Next scene");
  for (const control of [
    "Play prompt",
    "Forest path",
    "Second path",
    "Play guidance",
  ]) {
    // Buttons remain pending until the short fixture ends; switching sequences cancels the old one.
    await author.getByRole("button", { name: control, exact: true }).click();
    await author.waitForFunction(() => {
      const a = document.querySelector("audio");
      return a && a.currentTime > 0 && !a.paused;
    });
  }
  await click(author, "Pause");
  assert.equal(
    await author.locator("audio").evaluate((a: HTMLAudioElement) => a.paused),
    true,
  );
  await click(author, "Resume");
  await click(author, "Next scene");
  await click(author, "Play scene");
  await author.waitForFunction(() => {
    const a = document.querySelector("audio");
    return a && a.currentTime > 0;
  });
  await click(author, "Mark revision previewed");
  pass(
    "choice creation, localized hints, unreachable-scene focus, six uploads and narration/prompt/both responses/guidance/continuation preview",
  );

  await publisher.screenshot({
    path: join(directory, "studio-review.png"),
    fullPage: true,
  });
  await publisher.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await publisher.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  pass("390px responsive layout without horizontal overflow");
  assert.deepEqual(failures, []);
  await writeFile(
    join(directory, "results.json"),
    JSON.stringify({ checks, generatorCalls, failures }, null, 2),
  );
  console.log(`EVIDENCE ${directory}`);
  if (process.env.STUDIO_KEEP_SERVER === "1") {
    console.log(`SMOKE_SERVER ${origin}`);
    await new Promise((resolve) => process.once("SIGTERM", resolve));
  }
} finally {
  await browser.close();
  await app.close();
  store.db.close();
  if (process.env.STUDIO_REMOVE_EVIDENCE === "1")
    await rm(directory, { recursive: true, force: true });
}
