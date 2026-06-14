import OpenAI from 'openai';
import { GenAI } from './GenAI';
import { MetadataStore } from '../metadata/MetadataStore';
import { TITLE_SYSTEM_PROMPT, buildTitleUserPrompt } from './prompt';

export function OpenAIGenAI(metadata: MetadataStore, apiKey: string, model: string): GenAI {
  const openai = new OpenAI({ apiKey });
  return {
    suggestVideoTitle: async (filename: string) => {
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: TITLE_SYSTEM_PROMPT },
          { role: 'user', content: await buildTitleUserPrompt(metadata, filename) },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });
      return completion.choices[0]?.message?.content?.trim() || undefined;
    },
  } satisfies GenAI;
}
