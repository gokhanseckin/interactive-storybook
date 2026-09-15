import definition from './hiddenGardenStory.json';
import { StorySchema } from './storySchema';

export const hiddenGardenStory = StorySchema.parse(definition);
