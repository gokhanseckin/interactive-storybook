import { describe, it, expect } from "vitest";
import { StorySchema } from "./story.ts";
import source from "../../../apps/mobile/src/domain/hiddenGardenStory.json" with { type: "json" };
describe("shared graph contract", () => {
  it("accepts existing ElevenLabs graph", () =>
    expect(StorySchema.safeParse(source).success).toBe(true));
  it("rejects cycles and unreachable content", () => {
    const s: any = structuredClone(source);
    const keys = Object.keys(s.nodes);
    const end: any = Object.values(s.nodes).find(
      (n: any) => n.nextNodeId === null,
    )!;
    end.nextNodeId = s.entryNodeId;
    expect(StorySchema.safeParse(s).success).toBe(false);
  });
  it("requires localized hints and exactly two choices", () => {
    const s: any = structuredClone(source);
    const choice: any = Object.values(s.nodes).find(
      (n: any) => n.kind === "choice",
    );
    choice.options[0].voiceHints = [];
    expect(StorySchema.safeParse(s).success).toBe(false);
  });
});
