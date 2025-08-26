import { GenAI } from "../genai/GenAI";
import { IllegalArgumentError } from "../utils";

export async function suggetVideoTitle(deps: { genAI: GenAI }, filename: string): Promise<string> {
  if (filename.trim() === '') {
    throw new IllegalArgumentError('Filename cannot be empty');
  }
  const suggestedTitle = await deps.genAI.suggestVideoTitle(filename);
  if (suggestedTitle == null) {
    throw new SuggestTitleFailureError('Failed to get title suggestion');
  }
  return suggestedTitle;
}

export class SuggestTitleFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
