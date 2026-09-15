import type { PlayerState, TrackKind } from './playerMachine';
import type { AudioSegment, ChoiceNode, Story, StoryNode } from './storySchema';

export type PlaybackSectionItem = {
  segment: AudioSegment;
  nodeId: string;
  segmentIndex: number;
  trackKind: TrackKind;
  selectedOptionId: string | null;
  startSeconds: number;
  durationSeconds: number;
};

export type PlaybackSection = {
  label: string;
  items: PlaybackSectionItem[];
  durationSeconds: number;
};

export type SectionNavigationTarget = {
  nodeId: string;
  segmentIndex: number;
  trackKind: 'narration';
  selectedOptionId: null;
  positionSeconds: number;
};

export type SectionNavigation = {
  currentSection: number;
  totalSections: number;
  previous: SectionNavigationTarget | null;
  next: SectionNavigationTarget | null;
};

type DurationResolver = (segmentId: string) => number;

function addSegments(
  items: PlaybackSectionItem[],
  segments: AudioSegment[],
  nodeId: string,
  trackKind: TrackKind,
  selectedOptionId: string | null,
  resolveDuration: DurationResolver,
  firstSegmentIndex = 0,
) {
  let startSeconds = items.reduce(
    (total, item) => total + item.durationSeconds,
    0,
  );
  for (const [offset, segment] of segments.entries()) {
    const durationSeconds = resolveDuration(segment.id);
    items.push({
      segment,
      nodeId,
      segmentIndex: firstSegmentIndex + offset,
      trackKind,
      selectedOptionId,
      startSeconds,
      durationSeconds,
    });
    startSeconds += durationSeconds;
  }
}

function addNarrationChain(
  story: Story,
  startNodeId: string,
  items: PlaybackSectionItem[],
  resolveDuration: DurationResolver,
) {
  let nodeId: string | null = startNodeId;
  const visited = new Set<string>();

  while (nodeId && !visited.has(nodeId)) {
    visited.add(nodeId);
    const node: StoryNode | undefined = story.nodes[nodeId];
    if (!node || node.kind !== 'narration') break;
    addSegments(items, node.segments, nodeId, 'narration', null, resolveDuration);
    nodeId = node.nextNodeId;
  }
}

function findNarrationSectionStart(story: Story, nodeId: string): string {
  let startNodeId = nodeId;
  const visited = new Set<string>();

  while (!visited.has(startNodeId)) {
    visited.add(startNodeId);
    const predecessor = Object.values(story.nodes).find(
      (node) => node.kind === 'narration' && node.nextNodeId === startNodeId,
    );
    if (!predecessor) break;
    startNodeId = predecessor.id;
  }

  return startNodeId;
}

function findChoicePredecessor(
  story: Story,
  nodeId: string,
): ChoiceNode | undefined {
  return Object.values(story.nodes).find(
    (node): node is ChoiceNode => node.kind === 'choice' && node.nextNodeId === nodeId,
  );
}

type NarrationSection = {
  startNodeId: string;
  nodeIds: string[];
  followingChoiceId: string | null;
};

function getNarrationSections(story: Story): NarrationSection[] {
  const sections: NarrationSection[] = [];
  const visited = new Set<string>();
  let nodeId: string | null = story.entryNodeId;

  while (nodeId && !visited.has(nodeId)) {
    const firstNode: StoryNode | undefined = story.nodes[nodeId];
    if (!firstNode) break;

    if (firstNode.kind === 'choice') {
      visited.add(firstNode.id);
      nodeId = firstNode.nextNodeId;
      continue;
    }

    const section: NarrationSection = {
      startNodeId: firstNode.id,
      nodeIds: [],
      followingChoiceId: null,
    };
    let narrationNode: StoryNode | undefined = firstNode;

    while (narrationNode?.kind === 'narration' && !visited.has(narrationNode.id)) {
      visited.add(narrationNode.id);
      section.nodeIds.push(narrationNode.id);
      const nextNode: StoryNode | undefined = narrationNode.nextNodeId
        ? story.nodes[narrationNode.nextNodeId]
        : undefined;

      if (nextNode?.kind === 'narration') {
        narrationNode = nextNode;
        continue;
      }

      if (nextNode?.kind === 'choice') {
        section.followingChoiceId = nextNode.id;
        visited.add(nextNode.id);
        nodeId = nextNode.nextNodeId;
      } else {
        nodeId = null;
      }
      break;
    }

    sections.push(section);
  }

  return sections;
}

function sectionTarget(section: NarrationSection): SectionNavigationTarget {
  return {
    nodeId: section.startNodeId,
    segmentIndex: 0,
    trackKind: 'narration',
    selectedOptionId: null,
    positionSeconds: 0,
  };
}

export function getSectionNavigation(
  story: Story,
  state: PlayerState,
): SectionNavigation {
  const sections = getNarrationSections(story);
  const currentNode = story.nodes[state.nodeId];
  let currentIndex = sections.findIndex(({ nodeIds }) => nodeIds.includes(state.nodeId));

  if (currentNode?.kind === 'choice') {
    currentIndex = sections.findIndex(
      ({ followingChoiceId }) => followingChoiceId === currentNode.id,
    );
  }

  if (currentIndex < 0) currentIndex = 0;

  const displayedSectionIndex =
    currentNode?.kind === 'choice' && state.trackKind === 'choiceResponse'
      ? Math.min(currentIndex + 1, Math.max(0, sections.length - 1))
      : currentIndex;
  const previousIndex =
    currentNode?.kind === 'choice' ? currentIndex : currentIndex - 1;
  const nextIndex = currentIndex + 1;

  return {
    currentSection: displayedSectionIndex + 1,
    totalSections: sections.length,
    previous: sections[previousIndex] ? sectionTarget(sections[previousIndex]) : null,
    next: sections[nextIndex] ? sectionTarget(sections[nextIndex]) : null,
  };
}

export function buildPlaybackSection(
  story: Story,
  state: PlayerState,
  resolveDuration: DurationResolver,
): PlaybackSection | null {
  const node = story.nodes[state.nodeId];
  if (!node) return null;

  const items: PlaybackSectionItem[] = [];

  if (node.kind === 'choice' && state.trackKind !== 'choiceResponse') {
    const segment =
      state.trackKind === 'choiceGuidance'
        ? node.guidanceSegment
        : node.promptSegments[state.segmentIndex] ?? node.promptSegments[0];
    addSegments(
      items,
      [segment],
      node.id,
      state.trackKind,
      null,
      resolveDuration,
      state.trackKind === 'choicePrompt' ? state.segmentIndex : 0,
    );
    return {
      label: state.trackKind === 'choiceGuidance' ? 'Seçim hatırlatması' : 'Seçim sorusu',
      items,
      durationSeconds: items[0]?.durationSeconds ?? 0,
    };
  }

  if (node.kind === 'choice') {
    const option = node.options.find(({ id }) => id === state.selectedOptionId);
    if (!option) return null;
    addSegments(
      items,
      option.responseSegments,
      node.id,
      'choiceResponse',
      option.id,
      resolveDuration,
    );
    addNarrationChain(story, node.nextNodeId, items, resolveDuration);
  } else {
    const startNodeId = findNarrationSectionStart(story, node.id);
    const choicePredecessor = findChoicePredecessor(story, startNodeId);
    const selectedOptionId = choicePredecessor
      ? state.selectedOptionsByChoiceId[choicePredecessor.id] ?? null
      : null;
    const selectedOption = choicePredecessor?.options.find(
      ({ id }) => id === selectedOptionId,
    );

    if (choicePredecessor && selectedOption) {
      addSegments(
        items,
        selectedOption.responseSegments,
        choicePredecessor.id,
        'choiceResponse',
        selectedOption.id,
        resolveDuration,
      );
    }
    addNarrationChain(story, startNodeId, items, resolveDuration);
  }

  return {
    label: `${getSectionNavigation(story, state).currentSection}. seçime kadar`,
    items,
    durationSeconds: items.reduce((total, item) => total + item.durationSeconds, 0),
  };
}

export function getPlaybackSectionElapsed(
  section: PlaybackSection,
  state: PlayerState,
  currentSegmentSeconds: number,
): number {
  if (state.mode === 'completed') return section.durationSeconds;
  if (state.mode === 'awaitingChoice' && state.trackKind === 'choicePrompt') {
    return section.durationSeconds;
  }

  const current = section.items.find(
    (item) =>
      item.nodeId === state.nodeId &&
      item.segmentIndex === state.segmentIndex &&
      item.trackKind === state.trackKind &&
      (item.trackKind !== 'choiceResponse' ||
        item.selectedOptionId === state.selectedOptionId),
  );
  if (!current) return 0;
  return Math.min(
    section.durationSeconds,
    current.startSeconds + Math.max(0, currentSegmentSeconds),
  );
}

export function findPlaybackSectionTarget(
  section: PlaybackSection,
  requestedSeconds: number,
): { item: PlaybackSectionItem; positionSeconds: number } | null {
  if (section.items.length === 0 || section.durationSeconds <= 0) return null;

  const seconds = Math.min(
    Math.max(0, requestedSeconds),
    Math.max(0, section.durationSeconds - 0.01),
  );
  const item =
    section.items.find(
      (candidate) => seconds < candidate.startSeconds + candidate.durationSeconds,
    ) ?? section.items.at(-1);
  if (!item) return null;

  return {
    item,
    positionSeconds: Math.min(
      item.durationSeconds,
      Math.max(0, seconds - item.startSeconds),
    ),
  };
}
