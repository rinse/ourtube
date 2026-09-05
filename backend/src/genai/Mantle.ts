import OpenAI from 'openai';
import { GenAI } from './GenAI';
import { MetadataStore } from '../metadata/MetadataStore';
import { TITLE_SYSTEM_PROMPT, buildTitleUserPrompt } from './prompt';

export function MantleGenAI(metadata: MetadataStore, apiKey: string, region: string, model: string): GenAI {
  const baseURL = `https://bedrock-mantle.${region}.api.aws/openai/v1`;
  console.log('MantleGenAI using baseURL:', baseURL, 'model:', model);
  const openai = new OpenAI({ baseURL, apiKey });
  return {
    suggestVideoTitle: async (filename: string, playlistTitles: string[]) => {
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: TITLE_SYSTEM_PROMPT },
          { role: 'user', content: await buildTitleUserPrompt(metadata, filename, playlistTitles) },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });
      return completion.choices[0]?.message?.content?.trim() || undefined;
    },
  } satisfies GenAI;
}
