import { z } from 'zod';

export const AudioSegmentSchema = z.object({
  id: z.string().min(1),
  speaker: z.string().min(1),
  text: z.string().min(1),
  style: z.string().min(1),
  audioKey: z.string().min(1),
});

const NarrationNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('narration'),
  segments: z.array(AudioSegmentSchema).min(1),
  nextNodeId: z.string().min(1).nullable(),
});

const ChoiceOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  voiceHints: z.array(z.string().min(1)).min(1),
  responseSegments: z.array(AudioSegmentSchema).min(1),
});

const ChoiceNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('choice'),
  promptSegments: z.array(AudioSegmentSchema).min(1),
  guidanceSegment: AudioSegmentSchema,
  options: z.array(ChoiceOptionSchema).length(2),
  nextNodeId: z.string().min(1),
});

export const StorySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    title: z.string().min(1),
    language: z
      .string()
      .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, 'Language must be a BCP-47 tag.'),
    ageBand: z.enum(['3-5', '6-8', '9-12', '13-17', '18+']),
    episode: z.object({
      number: z.number().int().positive(),
      title: z.string().min(1),
    }),
    entryNodeId: z.string().min(1),
    nodes: z.record(
      z.string(),
      z.discriminatedUnion('kind', [NarrationNodeSchema, ChoiceNodeSchema]),
    ),
  })
  .superRefine((story, context) => {
    if (!story.nodes[story.entryNodeId]) {
      context.addIssue({
        code: 'custom',
        path: ['entryNodeId'],
        message: 'Entry node does not exist.',
      });
    }

    for (const [nodeId, node] of Object.entries(story.nodes)) {
      if (node.id !== nodeId) {
        context.addIssue({
          code: 'custom',
          path: ['nodes', nodeId, 'id'],
          message: 'Node id must match its record key.',
        });
      }

      if (node.nextNodeId && !story.nodes[node.nextNodeId]) {
        context.addIssue({
          code: 'custom',
          path: ['nodes', nodeId, 'nextNodeId'],
          message: 'Next node does not exist.',
        });
      }

      if (node.kind === 'choice') {
        const optionIds = new Set(node.options.map((option) => option.id));
        if (optionIds.size !== node.options.length) {
          context.addIssue({
            code: 'custom',
            path: ['nodes', nodeId, 'options'],
            message: 'Choice option ids must be unique.',
          });
        }
      }
    }
  });

export type AudioSegment = z.infer<typeof AudioSegmentSchema>;
export type Story = z.infer<typeof StorySchema>;
export type StoryNode = Story['nodes'][string];
export type ChoiceNode = Extract<StoryNode, { kind: 'choice' }>;
export type ChoiceOption = ChoiceNode['options'][number];
