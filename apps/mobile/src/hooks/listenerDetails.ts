import type { Manifest } from "@story/contracts";

export async function listeningManifest(
  storyId: string,
  locale: string,
  latest: string,
  api: {
    activeSession(storyId: string, locale: string): Promise<string | null>;
    manifest(releaseId: string): Promise<Manifest>;
  },
) {
  const releaseId = (await api.activeSession(storyId, locale)) ?? latest;
  const manifest = await api.manifest(releaseId);
  if (
    manifest.storyId !== storyId ||
    manifest.locale !== locale ||
    manifest.releaseId !== releaseId
  )
    throw new Error(
      "The saved release does not match this story and language.",
    );
  return manifest;
}
