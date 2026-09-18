const root = document.querySelector("#app"),
  notice = document.querySelector("#notice");
let user,
  current,
  tab = "Details",
  previewManifest,
  previewNode,
  previewAudio = new Audio();
previewAudio.controls = true;
let savedDraft = "",
  jsonDraft = null,
  conflict = false,
  requestPending = false;
let playbackVersion = 0,
  cancelPlayback;
const hasRole = (role) => user?.roles.some((r) => r === role || r === "admin");
const canEdit = () =>
  hasRole("admin") ||
  (hasRole("creator") &&
    (current?.owner === user.id || current?.editors.includes(user.id)));
const draftValue = () =>
  JSON.stringify({ story: current.story, card: current.card });
const dirty = () =>
  Boolean(current && (jsonDraft !== null || draftValue() !== savedDraft));
function updateDirty() {
  const status = document.querySelector("#edit-status");
  if (status)
    status.textContent = dirty()
      ? "Unsaved changes. Saving invalidates preview and review for this draft."
      : `Saved revision ${current.revision}. Preview: ${current.preview?.revision === current.revision ? "acknowledged" : "required"}. Review: ${current.review?.revision === current.revision ? "approved" : "required"}.`;
}
function leaveDraft() {
  return (
    !dirty() ||
    confirm(
      "Discard your unsaved changes? Export a copy first if you need to keep them.",
    )
  );
}
function requireSaved() {
  if (dirty())
    throw new Error(
      "Save or discard your changes before using this action. It applies to the saved revision.",
    );
  if (conflict)
    throw new Error(
      "The server revision changed. Reload the latest revision before continuing.",
    );
}
function stopPlayback() {
  playbackVersion++;
  previewAudio.pause();
  cancelPlayback?.();
  cancelPlayback = null;
  previewAudio.onended = previewAudio.onerror = null;
}
window.addEventListener("beforeunload", (e) => {
  if (dirty() || requestPending) {
    e.preventDefault();
    e.returnValue = "";
  }
});
document.querySelector(".brand").onclick = (e) => {
  e.preventDefault();
  if (!requestPending) run(library);
};
function exportDraft() {
  // Recovery includes catalog edits and unapplied JSON as well as the story.
  const recovery = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          {
            revision: current.revision,
            story: current.story,
            card: current.card,
            jsonDraft,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  el("a", "", {
    href: recovery,
    download: `${current.id}-recovery.json`,
  }).click();
  URL.revokeObjectURL(recovery);
}
function errorLinks(message, parent = notice) {
  for (const text of message.split("\n")) {
    parent.append(button(text, () => locateError(text)));
  }
}
function locateError(message) {
  let path = message.split(":")[0];
  if (["description", "cover"].includes(path)) path = "card." + path;
  if (path === "card.title") path = "title";
  if (path === "card.ageBand") path = "ageBand";
  tab = path.startsWith("audio.")
    ? "Audio"
    : /^(nodes|entryNodeId)/.test(path)
      ? "Content"
      : "Details";
  render();
  const targets = [...root.querySelectorAll("[data-path]")];
  const target = targets
    .filter(
      (e) => path === e.dataset.path || path.startsWith(e.dataset.path + "."),
    )
    .sort((a, b) => b.dataset.path.length - a.dataset.path.length)[0];
  const focus = target?.matches("input,textarea,button")
    ? target
    : target?.querySelector("input,textarea,button") || target;
  if (focus) {
    if (!focus.matches("input,textarea,button")) focus.tabIndex = -1;
    focus.focus();
    focus.scrollIntoView({ block: "center" });
  }
}
function markPath(node, path) {
  node.dataset.path = path;
  return node;
}
async function request(path, options) {
  if (requestPending)
    throw new Error("A request is still in progress. Please wait.");
  requestPending = true;
  root.inert = true;
  document.querySelector("#identity").inert = true;
  try {
    const res = await fetch(path, options);
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(
        "The server response could not be read. Refresh status before retrying.",
      );
    }
    if (!res.ok) {
      const error = new Error(data.error || "Request failed");
      error.status = res.status;
      throw error;
    }
    return data;
  } finally {
    requestPending = false;
    root.inert = false;
    document.querySelector("#identity").inert = false;
  }
}
const el = (tag, text, props = {}) =>
  Object.assign(document.createElement(tag), { textContent: text, ...props });
const button = (label, fn, primary = false) => {
  const b = el("button", label, { className: primary ? "primary" : "" });
  b.type = "button";
  b.onclick = async () => {
    if (b.disabled || requestPending) return;
    b.disabled = true;
    try {
      await run(fn);
    } finally {
      b.disabled = false;
    }
  };
  return b;
};
const append = (parent, ...children) => {
  parent.append(...children.filter(Boolean));
  return parent;
};
const field = (label, value, onchange, type = "text") => {
  const wrap = el("label", label);
  const input = el(type === "textarea" ? "textarea" : "input", "", {
    value: value ?? "",
  });
  if (type !== "textarea") input.type = type;
  input.oninput = () => {
    onchange(input.value);
    updateDirty();
  };
  wrap.append(input);
  return wrap;
};
const box = (...nodes) =>
  append(el("div", "", { className: "panel" }), ...nodes);
const actions = (...nodes) =>
  append(el("div", "", { className: "actions" }), ...nodes);
async function api(path, body, method = body === undefined ? "GET" : "POST") {
  return request("/api" + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function run(fn) {
  notice.textContent = "";
  try {
    await fn();
  } catch (e) {
    notice.textContent = e.message;
    if (current && e.status === 409 && /revision changed/i.test(e.message)) {
      conflict = true;
      notice.append(
        el(
          "p",
          "Your local edits are preserved. Export a recovery copy, then reload and reconcile with the latest revision.",
        ),
        button("Export local changes", exportDraft),
        button("Reload latest revision", async () => {
          if (leaveDraft()) await open(current.id);
        }),
      );
    } else if (
      current &&
      /^(card\.|audio\.|nodes\.|entryNodeId|description:|cover:|title:|language:|ageBand:|voice\.|episode\.)/m.test(
        e.message,
      )
    ) {
      notice.textContent = "Please fix the following fields:";
      errorLinks(e.message);
    }
  }
}
const clips = (s) =>
  Object.values(s.nodes).flatMap((n) =>
    n.kind === "narration"
      ? n.segments
      : [
          ...n.promptSegments,
          n.guidanceSegment,
          ...n.options.flatMap((o) => o.responseSegments),
        ],
  );
const bytes = (n) => `${(n / 1048576).toFixed(1)} MB`;
async function open(id) {
  stopPlayback();
  const next = await api("/stories/" + id);
  current = next;
  savedDraft = draftValue();
  jsonDraft = null;
  conflict = false;
  previewManifest = null;
  render();
}
function login() {
  root.replaceChildren();
  let email = "",
    password = "";
  const form = el("form", "", { className: "login" });
  append(
    form,
    el("h1", "Welcome to Story Studio"),
    el("p", "Prepare a story, hear every path, and publish when it is ready."),
    field("Email", "", (v) => (email = v), "email"),
    field("Password", "", (v) => (password = v), "password"),
    el("button", "Sign in", { type: "submit", className: "primary" }),
  );
  form.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await api("/login", { email, password });
      await start();
    });
  };
  root.append(form);
}
async function start() {
  try {
    user = await api("/me");
    document.querySelector("#identity").replaceChildren(
      el("span", user.email + " "),
      button("Sign out", async () => {
        if (!leaveDraft()) return;
        await api("/logout", {});
        location.reload();
      }),
    );
    await library();
  } catch {
    login();
  }
}
async function library() {
  if (!leaveDraft()) return;
  stopPlayback();
  const stories = await api("/stories");
  current = null;
  jsonDraft = null;
  conflict = false;
  root.replaceChildren();
  append(root, el("h1", "Your story library"));
  const tools = el("div", "", { className: "toolbar" }),
    list = el("div");
  let query = "",
    filter = "all";
  const search = el("input", "", {
    placeholder: "Search stories",
    ariaLabel: "Search stories",
  });
  search.oninput = () => {
    query = search.value.toLowerCase();
    draw();
  };
  const select = el("select", "", { ariaLabel: "Filter state or visibility" });
  [
    "all",
    "draft",
    "in-review",
    "ready",
    "hidden",
    "coming-soon",
    "available",
  ].forEach((v) => select.append(el("option", v, { value: v })));
  select.onchange = () => {
    filter = select.value;
    draw();
  };
  append(
    tools,
    search,
    select,
    hasRole("creator") && button("New story", newStory, true),
  );
  append(root, tools, list);
  function draw() {
    list.replaceChildren();
    stories
      .filter(
        (d) =>
          d.story.title.toLowerCase().includes(query) &&
          (filter === "all" || d.state === filter || d.visibility === filter),
      )
      .forEach((d) =>
        list.append(
          append(
            el("article", "", { className: "book-row" }),
            append(
              el("div"),
              el("h2", d.story.title),
              el("span", `Content: ${d.state}`, { className: "badge" }),
              el("span", `Catalog: ${d.visibility}`, { className: "badge" }),
              el(
                "p",
                d.owner === user.id
                  ? "Owned by you"
                  : d.editors.includes(user.id)
                    ? "Shared with you"
                    : "Publisher review access",
                { className: "muted" },
              ),
            ),
            button("Open story", () => open(d.id)),
          ),
        ),
      );
    if (!list.childElementCount)
      list.append(
        el("p", "No stories match. Create a private draft to begin."),
      );
  }
  draw();
}
async function newStory() {
  const story = {
    schemaVersion: 1,
    id: "new",
    title: "Untitled story",
    language: "tr-TR",
    ageBand: "6-8",
    voice: {
      provider: "elevenlabs",
      model: "eleven_v3",
      stability: 0.5,
      providerVoice: "BwhlzGpUiZ9uHtfvCl1H",
      globalDirection: "Warm and clear narration.",
      speakerProfiles: { narrator: "Warm narrator" },
    },
    episode: { number: 1, title: "A new beginning" },
    entryNodeId: "scene-1",
    nodes: {
      "scene-1": {
        id: "scene-1",
        kind: "narration",
        segments: [
          { id: "clip-1", speaker: "narrator", text: "Once upon a time…" },
        ],
        nextNodeId: null,
      },
    },
  };
  const d = await api("/stories", { story });
  await open(d.id);
}
async function save() {
  if (conflict)
    throw new Error(
      "Reload the latest revision and reconcile your edits before saving.",
    );
  if (jsonDraft !== null)
    throw new Error(
      "Apply the JSON import or discard its changes before saving.",
    );
  const d = await api(
    "/stories/" + current.id,
    { revision: current.revision, story: current.story, card: current.card },
    "PUT",
  );
  await open(d.id);
  notice.textContent =
    "Draft saved. Preview and review must be completed again for this revision. Existing published releases are unchanged.";
}
function render() {
  root.replaceChildren();
  append(
    root,
    button("Back to library", library),
    el("h1", current.story.title),
    el("span", `Content: ${current.state} · revision ${current.revision}`, {
      className: "badge",
    }),
    el("span", `Catalog: ${current.visibility}`, { className: "badge" }),
  );
  append(
    root,
    el("p", "", { id: "edit-status", role: "status" }),
    actions(
      button("Export local changes", exportDraft),
      button("Reload latest revision", async () => {
        if (leaveDraft()) await open(current.id);
      }),
    ),
  );
  updateDirty();
  const layout = el("div", "", { className: "workspace" }),
    rail = el("nav", "", { className: "rail", ariaLabel: "Story workspace" }),
    content = el("section");
  [
    "Details",
    "Content",
    "Audio",
    "Preview",
    "Catalog",
    "Review & publish",
    "Access",
  ].forEach((t) => {
    const b = button(t, () => {
      stopPlayback();
      tab = t;
      render();
    });
    b.setAttribute("aria-selected", String(tab === t));
    rail.append(b);
  });
  append(layout, rail, content);
  root.append(layout);
  ({
    Details: details,
    Content: contentEditor,
    Audio: audioEditor,
    Preview: preview,
    Catalog: catalog,
    "Review & publish": review,
    Access: access,
  })[tab](content);
  const editing = ["Details", "Content", "Audio"].includes(tab);
  if (editing && !canEdit()) {
    content.prepend(
      el("p", "Read-only: editing requires creator access to this story."),
    );
    content.querySelectorAll("input,textarea,button").forEach((control) => {
      if (
        !["Listen", "Refresh queue", "Export JSON"].includes(
          control.textContent,
        )
      )
        control.disabled = true;
    });
  }
  if (["Catalog", "Review & publish"].includes(tab) && !hasRole("publisher")) {
    content.prepend(
      el(
        "p",
        "Only a publisher can change visibility, approve, publish, schedule or roll back releases.",
      ),
    );
    content.querySelectorAll("button,input").forEach((control) => {
      if (!control.dataset.validation) control.disabled = true;
    });
  }
}
function details(p) {
  append(
    p,
    el("h2", "Story details"),
    field("Title", current.story.title, (v) => {
      current.story.title = v;
      current.card.title = v;
    }),
    field(
      "Description",
      current.card.description,
      (v) => (current.card.description = v),
      "textarea",
    ),
    field(
      "Locale (BCP-47)",
      current.story.language,
      (v) => (current.story.language = v),
    ),
    field("Age band", current.story.ageBand, (v) => {
      current.story.ageBand = v;
      current.card.ageBand = v;
    }),
    field(
      "Episode title",
      current.story.episode.title,
      (v) => (current.story.episode.title = v),
    ),
    field(
      "Episode number",
      current.story.episode.number,
      (v) => (current.story.episode.number = Number(v)),
      "number",
    ),
    field(
      "Voice ID",
      current.story.voice.providerVoice,
      (v) => (current.story.voice.providerVoice = v),
    ),
    field(
      "Narration direction",
      current.story.voice.globalDirection,
      (v) => (current.story.voice.globalDirection = v),
      "textarea",
    ),
    button("Save details", save, true),
    el("h2", "Cover"),
    upload(null),
  );
  const paths = [
    "title",
    "card.description",
    "language",
    "ageBand",
    "episode.title",
    "episode.number",
    "voice.providerVoice",
    "voice.globalDirection",
  ];
  [...p.querySelectorAll("label")].forEach((label, i) =>
    markPath(label, paths[i]),
  );
  markPath(p.querySelector('input[type="file"]'), "card.cover");
}
function upload(segmentId) {
  const maxUploadBytes = 99_999_999;
  const input = el("input", "", {
    type: "file",
    accept: segmentId ? "audio/mpeg" : ".png,.jpg,.jpeg",
    ariaLabel: segmentId ? "Upload MP3" : "Upload cover",
  });
  input.onchange = () =>
    run(async () => {
      requireSaved();
      const f = input.files[0];
      input.value = "";
      if (!f) return;
      if (f.size > maxUploadBytes)
        throw new Error(
          "File exceeds the 99,999,999-byte hosted upload limit. Choose a smaller MP3 or image.",
        );
      const url = `/api/stories/${current.id}/assets?revision=${current.revision}${segmentId ? "&segmentId=" + encodeURIComponent(segmentId) : ""}`;
      notice.textContent = `Uploading ${f.name} and validating media…`;
      await request(url, {
        method: "POST",
        headers: { "Content-Type": segmentId ? "audio/mpeg" : f.type },
        body: f,
      });
      await open(current.id);
      notice.textContent =
        "Upload validated and attached. Preview and review were reset.";
    });
  return input;
}
function contentEditor(p) {
  append(
    p,
    el("h2", "Scenes and choices"),
    el(
      "p",
      "Scenes play in order. Each choice has two responses and a shared continuation. Edits remain local across tabs until saved.",
    ),
  );
  p.append(
    markPath(
      field(
        "Entry scene",
        current.story.entryNodeId,
        (v) => (current.story.entryNodeId = v),
      ),
      "entryNodeId",
    ),
  );
  // Follow graph order first, then expose disconnected scenes for repair.
  const ordered = [],
    seen = new Set();
  let cursor = current.story.entryNodeId;
  while (cursor && current.story.nodes[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    ordered.push([cursor, current.story.nodes[cursor]]);
    cursor = current.story.nodes[cursor].nextNodeId;
  }
  ordered.push(
    ...Object.entries(current.story.nodes).filter(([key]) => !seen.has(key)),
  );
  for (const [nodeId, n] of ordered) {
    const block = el("div", "", {
      className: n.kind === "choice" ? "scene choice" : "scene",
    });
    append(
      block,
      el("h3", `${n.kind === "choice" ? "Choice" : "Scene"}: ${n.id}`),
    );
    markPath(block, `nodes.${nodeId}`);
    block.append(
      markPath(
        field(
          "Next scene (empty ends narration)",
          n.nextNodeId,
          (v) => (n.nextNodeId = v || null),
        ),
        `nodes.${nodeId}.nextNodeId`,
      ),
    );
    if (n.kind === "narration")
      n.segments.forEach((s, i) =>
        block.append(segmentFields(s, `nodes.${nodeId}.segments.${i}`)),
      );
    else {
      n.promptSegments.forEach((s, i) =>
        block.append(segmentFields(s, `nodes.${nodeId}.promptSegments.${i}`)),
      );
      block.append(
        el("h4", "Guidance"),
        segmentFields(n.guidanceSegment, `nodes.${nodeId}.guidanceSegment`),
      );
      n.options.forEach((o, oi) => {
        append(
          block,
          markPath(
            field("Option label", o.label, (v) => (o.label = v)),
            `nodes.${nodeId}.options.${oi}.label`,
          ),
          markPath(
            field(
              "Voice hints (comma separated)",
              o.voiceHints.join(", "),
              (v) =>
                (o.voiceHints = v
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean)),
            ),
            `nodes.${nodeId}.options.${oi}.voiceHints`,
          ),
        );
        o.responseSegments.forEach((s, i) =>
          block.append(
            segmentFields(
              s,
              `nodes.${nodeId}.options.${oi}.responseSegments.${i}`,
            ),
          ),
        );
      });
    }
    p.append(block);
  }
  append(
    p,
    actions(
      button("Add scene", () => addNode(false)),
      button("Add choice", () => addNode(true)),
      button("Save content", save, true),
    ),
  );
  const json = el("textarea", "", {
    value: jsonDraft ?? JSON.stringify(current.story, null, 2),
    className: "json",
    ariaLabel: "Story JSON",
  });
  json.oninput = () => {
    jsonDraft = json.value;
    updateDirty();
  };
  append(
    p,
    el("h2", "Import / export"),
    json,
    actions(
      button("Import JSON into editor", () => {
        const s = JSON.parse(json.value);
        if (
          !s ||
          !s.nodes ||
          !s.voice ||
          !s.episode ||
          typeof s.title !== "string" ||
          !Object.values(s.nodes).every(
            (n) =>
              n &&
              typeof n.id === "string" &&
              (n.kind === "narration"
                ? Array.isArray(n.segments) && n.segments.every(validSegment)
                : n.kind === "choice" &&
                  Array.isArray(n.promptSegments) &&
                  n.promptSegments.every(validSegment) &&
                  validSegment(n.guidanceSegment) &&
                  Array.isArray(n.options) &&
                  n.options.every(
                    (o) =>
                      o &&
                      Array.isArray(o.voiceHints) &&
                      Array.isArray(o.responseSegments) &&
                      o.responseSegments.every(validSegment),
                  )),
          )
        )
          throw new Error(
            "JSON needs story details, voice, episode and well-formed scenes. Your import text is preserved. Full schema and graph validation runs on Save content.",
          );
        s.id = current.id;
        current.story = s;
        current.card.title = s.title;
        current.card.ageBand = s.ageBand;
        jsonDraft = null;
        render();
      }),
      button("Discard JSON changes", () => {
        if (confirm("Discard unapplied JSON changes?")) {
          jsonDraft = null;
          render();
        }
      }),
      button("Export JSON", () => {
        const blob = new Blob([JSON.stringify(current.story, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = el("a", "", { href: url, download: `${current.id}.json` });
        a.click();
        URL.revokeObjectURL(url);
      }),
    ),
  );
}
function validSegment(s) {
  return (
    s &&
    typeof s.id === "string" &&
    typeof s.text === "string" &&
    typeof s.speaker === "string"
  );
}
function segmentFields(s, path) {
  const block = box(
    el("span", s.id, { className: "muted" }),
    field("Spoken text", s.text, (v) => (s.text = v), "textarea"),
    field("Speaker", s.speaker, (v) => (s.speaker = v)),
    field("Direction", s.direction, (v) => {
      if (v) s.direction = v;
      else delete s.direction;
    }),
    field(
      "Reviewed tagged text (optional)",
      s.ttsText,
      (v) => {
        if (v) s.ttsText = v;
        else delete s.ttsText;
      },
      "textarea",
    ),
  );
  markPath(block, path);
  ["text", "speaker", "direction", "ttsText"].forEach((name, i) =>
    markPath(block.querySelectorAll("label")[i], `${path}.${name}`),
  );
  return block;
}
function addNode(choice) {
  const id = "scene-" + crypto.randomUUID().slice(0, 8),
    clip = (suffix) => ({
      id: id + "-" + suffix,
      speaker: "narrator",
      text: "Write narration here.",
    });
  const last = Object.values(current.story.nodes).find(
    (n) => n.nextNodeId === null,
  );
  if (!last) throw new Error("Fix story termination before adding a scene");
  if (choice) {
    const ending = id + "-ending";
    last.nextNodeId = id;
    current.story.nodes[id] = {
      id,
      kind: "choice",
      promptSegments: [clip("prompt")],
      guidanceSegment: clip("guidance"),
      options: [
        {
          id: id + "-a",
          label: "First path",
          voiceHints: ["first"],
          responseSegments: [clip("a")],
        },
        {
          id: id + "-b",
          label: "Second path",
          voiceHints: ["second"],
          responseSegments: [clip("b")],
        },
      ],
      nextNodeId: ending,
    };
    current.story.nodes[ending] = {
      id: ending,
      kind: "narration",
      segments: [clip("continuation")],
      nextNodeId: null,
    };
  } else {
    last.nextNodeId = id;
    current.story.nodes[id] = {
      id,
      kind: "narration",
      segments: [clip("narration")],
      nextNodeId: null,
    };
  }
  render();
}
function audioEditor(p) {
  append(
    p,
    el("h2", "Narration"),
    previewAudio,
    el(
      "p",
      `${clips(current.story).length} clips · ${current.errors.filter((e) => e.startsWith("audio.")).length} need attention`,
    ),
    el(
      "p",
      "Generation uses paid provider credits. Character counts are shown below; pricing depends on your provider plan. Uploads do not generate charges.",
    ),
  );
  for (const s of clips(current.story)) {
    const c = current.clips[s.id],
      error = current.errors.find((e) => e.startsWith("audio." + s.id + ":"));
    const block = markPath(
      el("div", "", { className: "clip" }),
      `audio.${s.id}`,
    );
    append(
      block,
      el("h3", s.id),
      el("p", s.text),
      el("p", error || "Audio ready", { className: error ? "error" : "muted" }),
      el("p", `${(s.ttsText || s.text).length} characters · ${s.speaker}`, {
        className: "muted",
      }),
      upload(s.id),
    );
    const jobs = current.jobs.filter((j) => j.segmentId === s.id);
    const blocked = jobs.some((j) =>
      ["queued", "running", "uncertain"].includes(j.state),
    );
    if (blocked)
      block.append(
        el(
          "p",
          "Generation is queued, running, or billing is uncertain. Refresh status; reconcile uncertain provider usage before authorizing another attempt.",
        ),
      );
    for (const provider of ["elevenlabs", "openai"]) {
      const scope = `studio-generation:${user.id}:${current.id}:${current.revision}:${s.id}:${provider}`;
      const generate = button(`Generate with ${provider}`, async () => {
        requireSaved();
        if (
          !confirm(
            `Authorize paid ${provider} generation for this clip (${(s.ttsText || s.text).length} characters)? A retry of this request uses the same attempt key.`,
          )
        )
          return;
        // Persist before dispatch: a lost response/reload must reuse the same key.
        let key = sessionStorage.getItem(scope);
        if (!key) {
          key = crypto.randomUUID();
          sessionStorage.setItem(scope, key);
        }
        notice.textContent = "Submitting generation request…";
        await api(`/stories/${current.id}/jobs`, {
          revision: current.revision,
          segmentId: s.id,
          provider,
          key,
          authorizePaidGeneration: true,
        });
        await open(current.id);
        notice.textContent =
          "Generation status refreshed. No provider call is retried automatically.";
      });
      generate.disabled = blocked;
      block.append(generate);
      if (
        sessionStorage.getItem(scope) &&
        jobs.some(
          (j) =>
            j.provider === provider &&
            ["complete", "failed", "stale", "cancelled"].includes(j.state),
        ) &&
        !blocked
      ) {
        block.append(
          button(`New ${provider} attempt`, () => {
            requireSaved();
            if (
              confirm(
                "Have you checked the previous result and provider usage? The next Generate action will authorize a new paid attempt.",
              )
            ) {
              sessionStorage.removeItem(scope);
              render();
            }
          }),
        );
      }
    }
    if (c)
      block.append(
        button("Listen", async () => {
          requireSaved();
          stopPlayback();
          const t = await api(`/stories/${current.id}/clip-delivery`, {
            segmentId: s.id,
            revision: current.revision,
          });
          previewAudio.src = t.url;
          await previewAudio.play();
        }),
      );
    for (const j of current.jobs.filter((j) => j.segmentId === s.id))
      append(
        block,
        el("p", `${j.provider}: ${j.state}${j.error ? " — " + j.error : ""}`, {
          className: j.error ? "error" : "muted",
        }),
      );
    p.append(block);
  }
  p.append(
    button("Refresh queue", () => {
      requireSaved();
      return open(current.id);
    }),
  );
}
async function playSegments(list) {
  stopPlayback();
  const version = playbackVersion,
    storyId = current.id,
    manifest = previewManifest;
  for (const s of list) {
    if (version !== playbackVersion) return;
    const a = manifest.audio[s.id];
    const ticket = await api(`/stories/${storyId}/delivery`, {
      assetId: a.id,
      revision: manifest.revision,
    });
    if (version !== playbackVersion) return;
    previewAudio.src = ticket.url;
    await new Promise((resolve, reject) => {
      cancelPlayback = resolve;
      previewAudio.onended = resolve;
      previewAudio.onerror = () =>
        reject(
          new Error(
            "Preview audio failed. Replay the scene to request a fresh delivery URL.",
          ),
        );
      previewAudio.play().catch(reject);
    });
  }
}

function preview(p) {
  append(
    p,
    el("h2", "Hear the exact draft"),
    el(
      "p",
      "Try both responses and the guidance before marking this revision previewed. Mobile staff preview uses the same manifest and protected delivery endpoints.",
    ),
    button(
      "Load preview",
      async () => {
        requireSaved();
        previewManifest = await api(`/stories/${current.id}/preview`, {
          revision: current.revision,
        });
        previewNode = previewManifest.story.entryNodeId;
        drawPreview(p);
      },
      true,
    ),
  );
}
function drawPreview(p) {
  p.replaceChildren();
  const n = previewManifest.story.nodes[previewNode];
  const panel = el("div", "", { className: "preview" });
  append(
    panel,
    el("h2", n.id),
    el(
      "p",
      n.kind === "narration"
        ? n.segments.map((s) => s.text).join(" ")
        : n.promptSegments.map((s) => s.text).join(" "),
    ),
    button("Play " + (n.kind === "narration" ? "scene" : "prompt"), () =>
      playSegments(n.kind === "narration" ? n.segments : n.promptSegments),
    ),
    button("Pause", () => previewAudio.pause()),
    button("Resume", () => previewAudio.play()),
  );
  if (n.kind === "choice") {
    for (const o of n.options)
      panel.append(button(o.label, () => playSegments(o.responseSegments)));
    panel.append(
      button("Play guidance", () => playSegments([n.guidanceSegment])),
    );
  }
  panel.append(previewAudio);
  append(
    p,
    panel,
    actions(
      n.nextNodeId
        ? button("Next scene", () => {
            stopPlayback();
            previewNode = n.nextNodeId;
            drawPreview(p);
          })
        : el("p", "The end"),
      button("Restart preview", () => {
        stopPlayback();
        previewNode = previewManifest.story.entryNodeId;
        drawPreview(p);
      }),
      button("Mark revision previewed", async () => {
        requireSaved();
        stopPlayback();
        await api(`/stories/${current.id}/previewed`, {
          revision: previewManifest.revision,
        });
        await open(current.id);
      }),
    ),
  );
}
function catalog(p) {
  append(
    p,
    el("h2", "Catalog visibility"),
    el(
      "p",
      "Visibility can change at any stage. Hidden removes discovery; withdrawal blocks new online playback. Previously downloaded MP3s remain playable.",
    ),
    actions(
      ...["hidden", "coming-soon", "available"].map((visibility) =>
        button(visibility, async () => {
          requireSaved();
          await api(`/stories/${current.id}/visibility`, { visibility });
          await open(current.id);
        }),
      ),
    ),
    button(
      current.withdrawn
        ? "Restore online access"
        : "Withdraw new online playback",
      async () => {
        requireSaved();
        await api(`/stories/${current.id}/visibility`, {
          visibility: current.visibility,
          withdrawn: !current.withdrawn,
        });
        await open(current.id);
      },
    ),
  );
}
function review(p) {
  append(p, el("h2", "Review & publish"));
  if (current.errors.length) {
    current.errors.forEach((e) => {
      const link = button(e, () => locateError(e));
      link.dataset.validation = "true";
      p.append(link);
    });
  } else p.append(el("p", "All clips are current and complete."));
  append(
    p,
    actions(
      button("Approve previewed revision", async () => {
        requireSaved();
        await api(`/stories/${current.id}/review`, {
          revision: current.revision,
        });
        await open(current.id);
      }),
      button(
        "Freeze release candidate",
        async () => {
          requireSaved();
          await api(`/stories/${current.id}/releases`, {
            revision: current.revision,
          });
          await open(current.id);
        },
        true,
      ),
    ),
  );
  p.append(
    el(
      "p",
      `Preview ${current.preview?.revision === current.revision ? "acknowledged" : "required"} · Review ${current.review?.revision === current.revision ? "approved" : "required"}. Editing or uploading invalidates both.`,
    ),
  );
  for (const control of p.querySelectorAll("button")) {
    if (control.textContent === "Approve previewed revision")
      control.disabled =
        current.errors.length > 0 ||
        current.preview?.revision !== current.revision;
    if (control.textContent === "Freeze release candidate")
      control.disabled =
        current.errors.length > 0 ||
        current.review?.revision !== current.revision;
  }
  for (const m of current.releases) {
    const all = Object.values(m.audio).concat(m.artwork),
      total = [...new Map(all.map((a) => [a.id, a])).values()].reduce(
        (n, a) => n + a.bytes,
        0,
      ),
      duration = Object.values(m.audio).reduce((n, a) => n + a.duration, 0);
    const b = box(
      el("h3", `Revision ${m.revision} · ${m.locale}`),
      el("p", m.releaseId, { className: "muted" }),
      el(
        "p",
        current.active[m.locale] === m.releaseId
          ? "Active release"
          : "Retained release candidate",
      ),
      el(
        "p",
        `Title: ${m.story.title} · Locale: ${m.locale} · Episode: ${m.story.episode.title}`,
      ),
      el(
        "p",
        `Startup scene: ${m.story.entryNodeId} · ${bytes(startupBytes(m))} unique audio bytes`,
      ),
      el(
        "p",
        `${bytes(total)} · ${Math.floor(Math.round(duration) / 60)} min ${Math.round(duration) % 60} sec including both responses`,
      ),
      button(
        "Publish / roll back to this release",
        async () => {
          requireSaved();
          if (
            !confirm(
              `Activate revision ${m.revision} (${m.locale})? This makes the story available and restores online access. Existing releases are retained.`,
            )
          )
            return;
          await api(`/releases/${m.releaseId}/activate`, {});
          await open(current.id);
        },
        true,
      ),
    );
    let at = "";
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const scheduleStatus = el(
      "p",
      "Select a future time to see its exact UTC instant.",
      { role: "status" },
    );
    append(
      b,
      field(
        `Schedule date and time (${timeZone})`,
        "",
        (v) => {
          at = v;
          try {
            scheduleStatus.textContent =
              scheduleInstant(at).toISOString() + ` · ${timeZone}`;
          } catch (e) {
            scheduleStatus.textContent = e.message;
          }
        },
        "datetime-local",
      ),
      el(
        "p",
        `Time zone: ${timeZone} (browser zone). Change your system time zone to schedule in another zone. Ambiguous daylight-saving times are rejected.`,
      ),
      scheduleStatus,
      button("Schedule release", async () => {
        requireSaved();
        const instant = scheduleInstant(at).toISOString();
        const scope = `studio-schedule:${user.id}:${m.releaseId}:${instant}`;
        let key = sessionStorage.getItem(scope);
        if (!key) {
          key = crypto.randomUUID();
          sessionStorage.setItem(scope, key);
        }
        await api(`/releases/${m.releaseId}/schedule`, {
          at: instant,
          timeZone,
          key,
        });
        await open(current.id);
      }),
    );
    p.append(b);
  }
  for (const pub of current.publications) {
    const data = typeof pub.data === "string" ? JSON.parse(pub.data) : pub.data;
    append(
      p,
      box(
        el(
          "p",
          `${pub.state} · ${new Intl.DateTimeFormat(undefined, { timeZone: data.timeZone, dateStyle: "medium", timeStyle: "long" }).format(new Date(pub.due))} · ${data.timeZone}`,
        ),
        el(
          "p",
          `UTC: ${new Date(pub.due).toISOString()} · Release: ${data.releaseId}`,
        ),
        data.error ? el("p", data.error, { className: "error" }) : null,
        pub.state === "scheduled" &&
          button("Cancel schedule", async () => {
            requireSaved();
            await api(`/publications/${pub.id}/cancel`, {});
            // Cancellation allows a deliberate new schedule at the same instant.
            sessionStorage.removeItem(
              `studio-schedule:${user.id}:${data.releaseId}:${new Date(pub.due).toISOString()}`,
            );
            await open(current.id);
          }),
      ),
    );
  }
}
function startupBytes(m) {
  const n = m.story.nodes[m.story.entryNodeId];
  const ids =
    n.kind === "choice"
      ? m.choiceDependencies[n.id]
      : n.segments.map((s) => s.id);
  return [
    ...new Map(ids.map((id) => [m.audio[id].id, m.audio[id]])).values(),
  ].reduce((n, a) => n + a.bytes, 0);
}
function scheduleInstant(value) {
  const date = new Date(value);
  const local = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (!value || !Number.isFinite(date.getTime()))
    throw new Error("Select a valid schedule date and time.");
  if (local(date) !== value)
    throw new Error(
      "This local time does not exist because of a daylight-saving change.",
    );
  for (let offset = -180; offset <= 180; offset += 15) {
    if (offset && local(new Date(date.getTime() + offset * 60000)) === value)
      throw new Error(
        "This local time is ambiguous because of a daylight-saving change. Select another time.",
      );
  }
  if (date.getTime() <= Date.now())
    throw new Error("Schedule must be in the future.");
  return date;
}

start();

function access(p) {
  append(p, el("h2", "Story access"), el("p", `Owner: ${current.owner}`));
  if (!user.roles.includes("admin")) {
    p.append(el("p", "An administrator manages access and account roles."));
    return;
  }
  const draft = current;
  run(async () => {
    const users = await api("/users");
    if (current !== draft || !p.isConnected) return;
    let editors = new Set(draft.editors);
    for (const u of users) {
      const row = box(el("h3", u.email));
      const toggle = el("input", "", {
        type: "checkbox",
        checked: editors.has(u.id),
      });
      toggle.onchange = () =>
        toggle.checked ? editors.add(u.id) : editors.delete(u.id);
      append(row, append(el("label", "Can edit this story "), toggle));
      const roles = new Set(u.roles);
      for (const role of ["creator", "publisher", "admin"]) {
        const input = el("input", "", {
          type: "checkbox",
          checked: roles.has(role),
        });
        input.onchange = () =>
          input.checked ? roles.add(role) : roles.delete(role);
        append(row, append(el("label", role + " "), input));
      }
      row.append(
        button("Save account roles", async () => {
          await api(`/users/${u.id}/roles`, { roles: [...roles] }, "PUT");
          notice.textContent = "Roles saved. Existing sessions were revoked.";
        }),
      );
      p.append(row);
    }
    p.append(
      button(
        "Save story access",
        async () => {
          requireSaved();
          await api(`/stories/${draft.id}/access`, { editors: [...editors] });
          await open(current.id);
        },
        true,
      ),
    );
  });
}
