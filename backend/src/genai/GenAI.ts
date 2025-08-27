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
      lmStudioHost: string,
    },
  }): GenAI {
  if (deps.config.openaiApiKey) {
    console.log('Using OpenAI for GenAI');
    return OpenAIGenAI(deps.database, deps.config.openaiApiKey);
  } else {
    console.log('Using LM Studio for GenAI');
    return LMStudioGenAI(deps.database, deps.config.lmStudioHost);
  }
}
