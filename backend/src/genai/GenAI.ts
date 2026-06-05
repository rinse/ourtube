import { config } from "dotenv";
import { Database } from "../database";
import { LMStudioGenAI } from "./LMStudio";
import { OpenAIGenAI } from './OpenAI';

export type GenAI = {
  suggestVideoTitle: (filename: string) => Promise<string | undefined>;
}

export function createGenAI(
  deps: {
    database: Database,
    config: {
      openaiApiKey?: string,
      openaiModel: string,
      lmStudioHost: string,
      lmStudioModel: string,
    },
  }): GenAI {
  if (deps.config.openaiApiKey) {
    console.log('Using OpenAI for GenAI');
    return OpenAIGenAI(deps.database, deps.config.openaiApiKey, deps.config.openaiModel);
  } else {
    console.log('Using LM Studio for GenAI');
    return LMStudioGenAI(deps.database, deps.config.lmStudioHost, deps.config.lmStudioModel);
  }
}
