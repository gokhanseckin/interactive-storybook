import type { AudioSource } from "expo-audio";
import { assets, type Manifest, type Story } from "@story/contracts";
import { downloads } from "./native";
import { delivery } from "./client";
import { getAudioSource } from "../audio/audioAssets";
export type PlaybackContext = {
  releaseId: string;
  locale: string;
  manifest?: Manifest;
};
export async function source(
  story: Story,
  segmentId: string,
  nodeId: string,
  context: PlaybackContext,
  signal?: AbortSignal,
): Promise<AudioSource> {
  const m = context.manifest;
  if (!m) {
    const node = story.nodes[nodeId];
    const all =
      node.kind === "narration"
        ? node.segments
        : [
            ...node.promptSegments,
            node.guidanceSegment,
            ...node.options.flatMap((o) => o.responseSegments),
          ];
    const s = all.find((s) => s.id === segmentId)!;
    return getAudioSource(
      s.audioKey ?? `${story.id}/${story.language}/${s.id}`,
    );
  }
  const queue = await downloads(),
    asset = m.audio[segmentId];
  if (!asset) throw new Error("Audio is missing from this release");
  const node = story.nodes[nodeId],
    next = node.nextNodeId ? story.nodes[node.nextNodeId] : null;
  const deps =
    node.kind === "choice"
      ? m.choiceDependencies[nodeId]
      : next?.kind === "choice"
        ? m.choiceDependencies[next.id]
        : next?.kind === "narration"
          ? next.segments.slice(0, 1).map((s) => s.id)
          : [];
  const ids = (deps ?? []).map((id) => m.audio[id].id);
  const local = await queue.local(asset);
  queue.select(m, local ? undefined : asset.id, ids);
  if (node.kind === "choice") {
    // The prompt itself is gated, along with guidance, BOTH responses and continuation.
    queue.streaming = null;
    await queue.ensure(m, ids, signal);
    const ready = await queue.local(asset);
    if (!ready) throw new Error("Choice audio is not ready");
    return { uri: ready };
  }
  if (local) return { uri: local };
  return { uri: (await delivery(m, asset.id)).url };
}
