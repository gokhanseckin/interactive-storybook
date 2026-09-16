import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSpeechRequest, generateSpeech, TtsRequestSchema } from './elevenlabs.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const story = JSON.parse(await readFile(path.join(root, 'apps/mobile/src/domain/hiddenGardenStory.json'), 'utf8'));
type Segment = { id: string; text: string; ttsText?: string };
type Node = { kind: string; segments: Segment[]; promptSegments: Segment[]; guidanceSegment: Segment; options: { responseSegments: Segment[] }[] };
const all = Object.values(story.nodes as Record<string, Node>).flatMap(node => node.kind === 'narration'
  ? node.segments : [...node.promptSegments, node.guidanceSegment, ...node.options.flatMap(option => option.responseSegments)]);
const segments = process.argv.includes('--preview') ? all.filter(s => s.id === '01-section-one') : all;
const dryRun = process.argv.includes('--dry-run');
const metadataPath = path.join(root, 'apps/mobile/src/audio/hiddenGardenAudio.json');
const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<string, { durationSeconds: number; sha256: string; requestHash: string; sourceSegmentIds: string[] }>;
const directory = path.join(root, 'apps/mobile/assets/audio', story.id, story.language);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

if (process.argv.includes('--force')) throw new Error('Use a new audio edition for revised recordings; --force is not supported.');
if (story.voice.provider !== 'elevenlabs' || story.voice.model !== 'eleven_v3') throw new Error('Expected an ElevenLabs edition.');
const ids = new Set<string>();
for (const segment of segments) {
  if (!/^[a-z0-9-]+$/.test(segment.id) || ids.has(segment.id) || !metadata[segment.id]) throw new Error('Invalid track or missing audio metadata.');
  ids.add(segment.id);
  const request = buildSpeechRequest({ text: segment.text, ttsText: segment.ttsText, voice: story.voice.providerVoice, language: story.language, stability: story.voice.stability });
  const fingerprint = hash(JSON.stringify({ voiceId: story.voice.providerVoice, request }));
  if (metadata[segment.id]!.requestHash !== fingerprint) throw new Error(`Generation settings changed for ${segment.id}; prepare a new reviewed edition before generating.`);
  TtsRequestSchema.parse({ text: segment.text, ttsText: segment.ttsText, voice: story.voice.providerVoice, language: story.language, stability: story.voice.stability });
}
if (dryRun) {
  console.log(JSON.stringify({ provider: 'elevenlabs', model: story.voice.model, voice: story.voice.providerVoice,
    tracks: segments.map(s => ({ id: s.id, characters: (s.ttsText ?? s.text).length })) }, null, 2));
  process.exit(0);
}
await mkdir(directory, { recursive: true });
for (const segment of segments) {
  const output = path.join(directory, `${segment.id}.mp3`);
  try {
    const existing = await readFile(output);
    if (hash(existing) !== metadata[segment.id]!.sha256) throw new Error(`Audio checksum mismatch: ${segment.id}`);
    console.log(`Verified existing ${segment.id}`);
    continue;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is required to generate missing audio. Restore approved assets to avoid regeneration.');
  const input = { text: segment.text, ttsText: segment.ttsText, voice: story.voice.providerVoice, language: story.language, stability: story.voice.stability };
  // Ensure duration tooling is available before incurring generation costs.
  const tool = process.platform === 'darwin' ? 'afinfo' : 'ffprobe';
  try { execFileSync('which', [tool], { stdio: 'ignore' }); } catch { throw new Error(`Install ${tool} before generating audio.`); }
  console.log(`Generating ${segment.id}`);
  const { audio, requestId } = await generateSpeech(input, apiKey);
  const temp = `${output}.tmp.mp3`;
  await writeFile(temp, audio);
  const info = execFileSync(tool, tool === 'afinfo' ? [temp] : ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', temp], { encoding: 'utf8' });
  const duration = tool === 'afinfo' ? Number(info.match(/estimated duration: ([\d.]+)/)?.[1]) : Number(info.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not read duration for ${segment.id}; audio retained at ${temp}.`);
  await rename(temp, output);
  metadata[segment.id] = { ...metadata[segment.id]!, durationSeconds: duration, sha256: hash(audio) };
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
  await writeFile(path.join(directory, `${segment.id}.receipt.json`), JSON.stringify({ provider: 'elevenlabs', voice: story.voice.providerVoice, model: story.voice.model, requestId, requestHash: hash(JSON.stringify(buildSpeechRequest(input))), audioHash: hash(audio), generatedAt: new Date().toISOString() }, null, 2)+'\n');
}
