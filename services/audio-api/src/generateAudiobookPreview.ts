// One-off listening experiment. Deliberately not the future story chunking algorithm.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import OpenAI from 'openai';

const directory = fileURLToPath(new URL(
  process.argv.includes('--common-only')
    ? '../../../content/calarin-ardindaki-gizli-bahce/audiobook-preview-common-only/'
    : '../../../content/calarin-ardindaki-gizli-bahce/audiobook-preview/',
  import.meta.url,
));
const recipe = JSON.parse(await readFile(path.join(directory, 'requests.json'), 'utf8')) as {
  model: string;
  voice: 'marin';
  tracks: Array<{ id: string; title: string; input: string; instructions: string }>;
};
const dryRun = process.argv.includes('--dry-run');
const ids = new Set<string>();
for (const track of recipe.tracks) {
  if (!/^[a-z0-9-]+$/.test(track.id) || ids.has(track.id)) throw new Error('Invalid or duplicate track ID');
  ids.add(track.id);
  for (const value of [track.input, track.instructions]) {
    if (!value.trim() || Array.from(value).length > 4096) throw new Error(`Invalid input size: ${track.id}`);
  }
}
if (dryRun) {
  console.log(JSON.stringify(recipe.tracks.map(({ id, input, instructions }) => ({ id, inputCharacters: Array.from(input).length, instructionCharacters: Array.from(instructions).length })), null, 2));
  process.exit(0);
}
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 300_000 });
await mkdir(directory, { recursive: true });
for (const track of recipe.tracks) {
  const request = { model: recipe.model, voice: recipe.voice, input: track.input, instructions: track.instructions, response_format: 'mp3' as const };
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const output = path.join(directory, `${track.id}.mp3`);
  const receiptPath = path.join(directory, `${track.id}.receipt.json`);
  try {
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    const bytes = await readFile(output);
    if (receipt.requestHash === requestHash && receipt.audioHash === createHash('sha256').update(bytes).digest('hex')) {
      console.log(`Already generated: ${track.id}`);
      continue;
    }
    throw new Error(`Existing audio differs for ${track.id}; use a new preview version`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  console.log(`Generating one continuous take: ${track.id}`);
  const response = await client.audio.speech.create(request);
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length < 1000) throw new Error(`Unexpectedly small audio: ${track.id}`);
  await writeFile(`${output}.tmp`, audio);
  await rename(`${output}.tmp`, output);
  await writeFile(receiptPath, JSON.stringify({ requestHash, audioHash: createHash('sha256').update(audio).digest('hex'), model: recipe.model, voice: recipe.voice, generatedAt: new Date().toISOString(), bytes: audio.length }, null, 2) + '\n');
  console.log(`Generated: ${track.id} (${audio.length} bytes)`);
}
