import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { GenAI } from './GenAI';
import { MetadataStore } from '../metadata/MetadataStore';
import { TITLE_SYSTEM_PROMPT, buildTitleUserPrompt } from './prompt';

/**
 * Bedrock-backed title suggestion using the provider-agnostic Converse API,
 * so the same code works whether `modelId` points at a Claude or Nova model
 * (or an inference profile such as `apac.anthropic.claude-...`).
 */
export function BedrockGenAI(metadata: MetadataStore, region: string, modelId: string): GenAI {
  console.log('BedrockGenAI using region:', region, 'model:', modelId);
  const client = new BedrockRuntimeClient({ region });
  return {
    suggestVideoTitle: async (filename: string, playlistTitles: string[]) => {
      const userPrompt = await buildTitleUserPrompt(metadata, filename, playlistTitles);
      const res = await client.send(new ConverseCommand({
        modelId,
        system: [{ text: TITLE_SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: [{ text: userPrompt }] }],
        inferenceConfig: { maxTokens: 1000, temperature: 0.7 },
      }));
      const text = res.output?.message?.content
        ?.map((block) => ('text' in block ? block.text : ''))
        .join('')
        .trim();
      return text || undefined;
    },
  } satisfies GenAI;
}
