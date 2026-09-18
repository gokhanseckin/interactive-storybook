import { z } from "zod";
import { StorySchema, type Story, type AudioSegment } from "./story.ts";
export * from "./story.ts";
export const AssetSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive(),
    duration: z.number().nonnegative(),
    type: z.enum(["audio/mpeg", "image/png", "image/jpeg"]),
  })
  .refine((a) => a.id === a.sha256, "Asset identity must equal its checksum");
export type Asset = z.infer<typeof AssetSchema>;
export function segments(story: Story): AudioSegment[] {
  return Object.values(story.nodes).flatMap((n) =>
    n.kind === "narration"
      ? n.segments
      : [
          ...n.promptSegments,
          n.guidanceSegment,
          ...n.options.flatMap((o) => o.responseSegments),
        ],
  );
}
export function choiceDependencies(story: Story): Record<string, string[]> {
  return Object.fromEntries(
    Object.values(story.nodes)
      .filter((n) => n.kind === "choice")
      .map((n) => {
        const next = story.nodes[n.nextNodeId];
        const first =
          next?.kind === "narration"
            ? next.segments[0]
            : next?.promptSegments[0];
        return [
          n.id,
          [
            ...n.promptSegments,
            n.guidanceSegment,
            ...n.options.flatMap((o) => o.responseSegments),
            ...(first ? [first] : []),
          ].map((s) => s.id),
        ];
      }),
  );
}
export const ManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    playerVersion: z.literal(1),
    storyId: z.string(),
    releaseId: z.string(),
    locale: z.string(),
    revision: z.number().int().positive(),
    story: StorySchema,
    audio: z.record(z.string(), AssetSchema),
    artwork: z.array(AssetSchema),
    choiceDependencies: z.record(z.string(), z.array(z.string())),
    createdAt: z.string(),
  })
  .superRefine((m, ctx) => {
    if (m.storyId !== m.story.id || m.locale !== m.story.language)
      ctx.addIssue({
        code: "custom",
        message: "Story identity/locale mismatch",
      });
    for (const s of segments(m.story))
      if (
        !m.audio[s.id] ||
        m.audio[s.id].type !== "audio/mpeg" ||
        m.audio[s.id].duration <= 0
      )
        ctx.addIssue({
          code: "custom",
          path: ["audio", s.id],
          message: "Complete measured MP3 required",
        });
    if (
      JSON.stringify(choiceDependencies(m.story)) !==
      JSON.stringify(m.choiceDependencies)
    )
      ctx.addIssue({
        code: "custom",
        path: ["choiceDependencies"],
        message: "Choice dependencies mismatch",
      });
  });
export type Manifest = z.infer<typeof ManifestSchema>;
export function assets(m: Manifest): Asset[] {
  return [
    ...new Map(
      [...Object.values(m.audio), ...m.artwork].map((a) => [a.id, a]),
    ).values(),
  ];
}
export const CardSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(3000),
  ageBand: z.string(),
  cover: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .default(null),
});
export type Card = z.infer<typeof CardSchema>;
export const CatalogEntrySchema = z.object({
  id: z.string(),
  card: CardSchema,
  visibility: z.enum(["coming-soon", "available"]),
  releases: z.record(z.string(), z.string()),
});
export const CatalogSchema = z.array(CatalogEntrySchema);
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
