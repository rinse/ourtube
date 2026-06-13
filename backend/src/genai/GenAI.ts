import { AppConfig } from '../config';
import { MetadataStore } from '../metadata/MetadataStore';
import { LMStudioGenAI } from './LMStudio';
import { OpenAIGenAI } from './OpenAI';
import { BedrockGenAI } from './Bedrock';

export type GenAI = {
  suggestVideoTitle: (filename: string) => Promise<string | undefined>;
};

export function createGenAI(deps: { metadata: MetadataStore; config: AppConfig }): GenAI {
  const { genai } = deps.config;
  switch (genai.provider) {
    case 'bedrock':
      console.log('Using Bedrock for GenAI');
      return BedrockGenAI(deps.metadata, genai.bedrock.region, genai.bedrock.modelId);
    case 'openai':
      if (!genai.openai.apiKey) {
        throw new Error('GENAI_PROVIDER=openai but OPENAI_API_KEY is not set');
      }
      console.log('Using OpenAI for GenAI');
      return OpenAIGenAI(deps.metadata, genai.openai.apiKey, genai.openai.model);
    case 'lmstudio':
    default:
      console.log('Using LM Studio for GenAI');
      return LMStudioGenAI(deps.metadata, genai.lmStudio.host, genai.lmStudio.model);
  }
}
