import { config } from "../config";
import { LMStudioGenAI } from "./LMStudio";
import { OpenAIGenAI } from './OpenAI';

export type GenAI = {
  suggestVideoTitle: (filename: string) => Promise<string | undefined>;
}

export function createGenAI(): GenAI {
  if (config.openaiApiKey) {
    console.log('Using OpenAI for GenAI');
    return OpenAIGenAI(config.openaiApiKey);
  } else {
    console.log('Using LM Studio for GenAI');
    return LMStudioGenAI();
  }
}
