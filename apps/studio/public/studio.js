const root = document.querySelector("#app"),
  notice = document.querySelector("#notice");
let user,
  current,
  tab = "Details",
  previewManifest,
  previewNode,
  previewAudio = new Audio();
previewAudio.controls = true;
const el = (tag, text, props = {}) =>
  Object.assign(document.createElement(tag), { textContent: text, ...props });
const button = (label, fn, primary = false) => {
  const b = el("button", label, { className: primary ? "primary" : "" });
  b.onclick = () => run(fn);
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
  input.oninput = () => onchange(input.value);
  wrap.append(input);
  return wrap;
};
const box = (...nodes) =>
  append(el("div", "", { className: "panel" }), ...nodes);
const actions = (...nodes) =>
  append(el("div", "", { className: "actions" }), ...nodes);
async function api(path, body, method = body === undefined ? "GET" : "POST") {
  const res = await fetch("/api" + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
async function run(fn) {
  notice.textContent = "";
  try {
    await fn();
  } catch (e) {
    notice.textContent = e.message;
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
  previewAudio.pause();
  current = await api("/stories/" + id);
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
  previewAudio.pause();
  current = null;
  root.replaceChildren();
  const stories = await api("/stories");
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
  append(tools, search, select, button("New story", newStory, true));
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
                d.owner === user.id ? "Owned by you" : "Shared with you",
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
  const d = await api(
    "/stories/" + current.id,
    { revision: current.revision, story: current.story, card: current.card },
    "PUT",
  );
  await open(d.id);
  notice.textContent =
    "Draft saved. Existing published releases are unchanged.";
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
      previewAudio.pause();
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
}
function upload(segmentId) {
  const input = el("input", "", {
    type: "file",
    accept: segmentId ? "audio/mpeg" : ".png,.jpg,.jpeg",
    ariaLabel: segmentId ? "Upload MP3" : "Upload cover",
  });
  input.onchange = () =>
    run(async () => {
      const f = input.files[0];
      if (!f) return;
      const url = `/api/stories/${current.id}/assets?revision=${current.revision}${segmentId ? "&segmentId=" + encodeURIComponent(segmentId) : ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": segmentId ? "audio/mpeg" : f.type },
        body: f,
      });
      if (!res.ok) throw new Error((await res.json()).error);
      await open(current.id);
    });
  return input;
}
function contentEditor(p) {
  append(
    p,
    el("h2", "Scenes and choices"),
    el(
      "p",
      "Scenes play in order. Each choice has two responses and a shared continuation. Save before leaving this tab.",
    ),
  );
  let node = current.story.nodes[current.story.entryNodeId],
    seen = new Set();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    const n = node;
    const block = el("div", "", {
      className: n.kind === "choice" ? "scene choice" : "scene",
    });
    append(
      block,
      el("h3", `${n.kind === "choice" ? "Choice" : "Scene"}: ${n.id}`),
    );
    if (n.kind === "narration")
      n.segments.forEach((s) => block.append(segmentFields(s)));
    else {
      n.promptSegments.forEach((s) => block.append(segmentFields(s)));
      block.append(el("h4", "Guidance"), segmentFields(n.guidanceSegment));
      n.options.forEach((o) => {
        append(
          block,
          field("Option label", o.label, (v) => (o.label = v)),
          field(
            "Voice hints (comma separated)",
            o.voiceHints.join(", "),
            (v) =>
              (o.voiceHints = v
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean)),
          ),
        );
        o.responseSegments.forEach((s) => block.append(segmentFields(s)));
      });
    }
    p.append(block);
    node = n.nextNodeId ? current.story.nodes[n.nextNodeId] : null;
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
    value: JSON.stringify(current.story, null, 2),
    className: "json",
    ariaLabel: "Story JSON",
  });
  append(
    p,
    el("h2", "Import / export"),
    json,
    actions(
      button("Import JSON into editor", () => {
        const s = JSON.parse(json.value);
        s.id = current.id;
        current.story = s;
        render();
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
function segmentFields(s) {
  return box(
    el("span", s.id, { className: "muted" }),
    field("Spoken text", s.text, (v) => (s.text = v), "textarea"),
    field("Speaker", s.speaker, (v) => (s.speaker = v)),
    field("Direction", s.direction, (v) => (s.direction = v)),
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
    const block = el("div", "", { className: "clip" });
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
    for (const provider of ["elevenlabs", "openai"])
      block.append(
        button(`Generate with ${provider}`, async () => {
          if (
            !confirm(
              `Authorize paid ${provider} generation for this clip (${s.text.length} characters)?`,
            )
          )
            return;
          const key = crypto.randomUUID();
          await api(`/stories/${current.id}/jobs`, {
            revision: current.revision,
            segmentId: s.id,
            provider,
            key,
            authorizePaidGeneration: true,
          });
          await open(current.id);
        }),
      );
    if (c)
      block.append(
        button("Listen", async () => {
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
  p.append(button("Refresh queue", () => open(current.id)));
}
async function playSegments(list) {
  for (const s of list) {
    const a = previewManifest.audio[s.id];
    const ticket = await api(`/stories/${current.id}/delivery`, {
      assetId: a.id,
      revision: previewManifest.revision,
    });
    previewAudio.src = ticket.url;
    await new Promise((resolve, reject) => {
      previewAudio.onended = resolve;
      previewAudio.onerror = () => reject(new Error("Preview audio failed"));
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
            previewAudio.pause();
            previewNode = n.nextNodeId;
            drawPreview(p);
          })
        : el("p", "The end"),
      button("Restart preview", () => {
        previewAudio.pause();
        previewNode = previewManifest.story.entryNodeId;
        drawPreview(p);
      }),
      button("Mark revision previewed", async () => {
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
      "Visibility can change at any stage. Authoring and published releases keep the same story ID.",
    ),
    actions(
      ...["hidden", "coming-soon", "available"].map((visibility) =>
        button(visibility, async () => {
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
    current.errors.forEach((e) =>
      p.append(
        button(e, () => {
          tab = e.startsWith("audio.") ? "Audio" : "Details";
          render();
        }),
      ),
    );
  } else p.append(el("p", "All clips are current and complete."));
  append(
    p,
    actions(
      button("Approve previewed revision", async () => {
        await api(`/stories/${current.id}/review`, {
          revision: current.revision,
        });
        await open(current.id);
      }),
      button(
        "Freeze release candidate",
        async () => {
          await api(`/stories/${current.id}/releases`, {
            revision: current.revision,
          });
          await open(current.id);
        },
        true,
      ),
    ),
  );
  for (const m of current.releases) {
    const all = Object.values(m.audio).concat(m.artwork),
      total = all.reduce((n, a) => n + a.bytes, 0),
      duration = Object.values(m.audio).reduce((n, a) => n + a.duration, 0);
    const b = box(
      el("h3", `Revision ${m.revision} · ${m.locale}`),
      el("p", m.releaseId, { className: "muted" }),
      el(
        "p",
        `${bytes(total)} · ${Math.round(duration / 60)} minutes including both responses`,
      ),
      button(
        "Publish / roll back to this release",
        async () => {
          await api(`/releases/${m.releaseId}/activate`, {});
          await open(current.id);
        },
        true,
      ),
    );
    let at = "",
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    append(
      b,
      field(
        "Schedule (local date and time)",
        "",
        (v) => (at = v),
        "datetime-local",
      ),
      field("Time zone", timeZone, (v) => (timeZone = v)),
      button("Schedule release", async () => {
        if (timeZone !== Intl.DateTimeFormat().resolvedOptions().timeZone)
          throw new Error(
            "Use your browser time zone when selecting local time",
          );
        await api(`/releases/${m.releaseId}/schedule`, {
          at: new Date(at).toISOString(),
          timeZone,
          key: at,
        });
        await open(current.id);
      }),
    );
    p.append(b);
  }
  for (const pub of current.publications)
    append(
      p,
      box(
        el(
          "p",
          `${pub.state} · ${new Date(pub.due).toLocaleString()} · ${JSON.parse(pub.data).timeZone}`,
        ),
        pub.state === "scheduled"
          ? button("Cancel schedule", async () => {
              await api(`/publications/${pub.id}/cancel`, {});
              await open(current.id);
            })
          : null,
      ),
    );
}
start();

function access(p) {
  append(p, el("h2", "Story access"), el("p", `Owner: ${current.owner}`));
  if (!user.roles.includes("admin")) {
    p.append(el("p", "An administrator manages access and account roles."));
    return;
  }
  run(async () => {
    const users = await api("/users");
    let editors = new Set(current.editors);
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
          await api(`/stories/${current.id}/access`, { editors: [...editors] });
          await open(current.id);
        },
        true,
      ),
    );
  });
}
