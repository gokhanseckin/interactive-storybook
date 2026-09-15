import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import OpenAI from 'openai';

import { buildAudioInstructions } from './prompts.js';

type StorySegment = {
  id: string;
  speaker: string;
  text: string;
  direction?: string;
};

type StoryNode =
  | { kind: 'narration'; segments: StorySegment[] }
  | {
      kind: 'choice';
      promptSegments: StorySegment[];
      guidanceSegment: StorySegment;
      options: Array<{ responseSegments: StorySegment[] }>;
    };

type StoryDocument = {
  id: string;
  language: string;
  voice: {
    providerVoice: string;
    globalDirection: string;
    speakerProfiles: Record<string, string>;
  };
  nodes: Record<string, StoryNode>;
};

const PREVIEW_SEGMENT_IDS = new Set([
  'intro-01',
  'intro-02',
  'intro-03',
  'intro-04',
  'intro-05',
  'intro-06',
  'intro-10',
  'intro-27',
  'choice-01-prompt',
  'shared-13',
]);

const dryRun = process.argv.includes('--dry-run');
const previewOnly = process.argv.includes('--preview');
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey && !dryRun) {
  throw new Error(
    'OPENAI_API_KEY is required. From services/audio-api, load .env before running this command.',
  );
}

const force = process.argv.includes('--force');
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const storyPath = path.join(
  repositoryRoot,
  'apps/mobile/src/domain/hiddenGardenStory.json',
);
const story = JSON.parse(await readFile(storyPath, 'utf8')) as StoryDocument;
const outputDirectory = path.join(
  repositoryRoot,
  'apps/mobile/assets/audio',
  story.id,
  story.language,
);

const allSegments = Object.values(story.nodes).flatMap((node) => {
  if (node.kind === 'narration') return node.segments;
  return [
    ...node.promptSegments,
    node.guidanceSegment,
    ...node.options.flatMap((option) => option.responseSegments),
  ];
});
const segments = previewOnly
  ? allSegments.filter(({ id }) => PREVIEW_SEGMENT_IDS.has(id))
  : allSegments;

if (previewOnly && segments.length !== PREVIEW_SEGMENT_IDS.size) {
  const foundIds = new Set(segments.map(({ id }) => id));
  const missingIds = [...PREVIEW_SEGMENT_IDS].filter((id) => !foundIds.has(id));
  throw new Error(`Preview segments not found: ${missingIds.join(', ')}`);
}

const segmentIds = new Set<string>();
for (const segment of segments) {
  if (!/^[a-z0-9-]+$/.test(segment.id)) {
    throw new Error(`Unsafe segment id: ${segment.id}`);
  }
  if (segmentIds.has(segment.id)) {
    throw new Error(`Duplicate segment id: ${segment.id}`);
  }
  if (!story.voice.speakerProfiles[segment.speaker]) {
    throw new Error(`Missing speaker profile: ${segment.speaker}`);
  }
  segmentIds.add(segment.id);
}

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        storyId: story.id,
        language: story.language,
        mode: previewOnly ? 'preview' : 'full',
        segments: segments.length,
        withDirection: segments.filter(({ direction }) => Boolean(direction)).length,
        maxTextCharacters: Math.max(...segments.map(({ text }) => text.length)),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

await mkdir(outputDirectory, { recursive: true });
const client = new OpenAI({ apiKey: apiKey! });

for (const segment of segments) {
  const outputPath = path.join(outputDirectory, `${segment.id}.mp3`);

  if (!force) {
    try {
      await access(outputPath);
      console.log(`Skipped existing ${segment.id}`);
      continue;
    } catch {
      // Generate the missing asset below.
    }
  }

  const response = await client.audio.speech.create({
    model: 'gpt-4o-mini-tts',
    voice: story.voice.providerVoice,
    input: segment.text,
    instructions: buildAudioInstructions({
      globalDirection: story.voice.globalDirection,
      speaker: segment.speaker,
      speakerProfile: story.voice.speakerProfiles[segment.speaker]!,
      direction: segment.direction,
    }),
    response_format: 'mp3',
  });
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength < 1_000) {
    throw new Error(`Generated audio is unexpectedly small for ${segment.id}.`);
  }

  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, audio);
  await rename(temporaryPath, outputPath);
  console.log(`Generated ${segment.id} (${audio.byteLength} bytes)`);
}
