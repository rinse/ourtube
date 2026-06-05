import OpenAI from 'openai';
import { GenAI } from './GenAI';
import { Database } from '../database';

const systemPrompt = {
  role: 'system',
  content: `You are a helpful assistant that suggests clear, descriptive video titles based on filenames and existing naming patterns.
 Given a video filename and some existing video titles in the library, suggest a clear, descriptive title for the new video.

Instructions:
- Create a title that's descriptive and follows the naming pattern of existing videos (if any)
- Remove file extensions from the filename
- Capitalize appropriately
- Keep it concise but informative
- Return ONLY the suggested title itself, nothing else
- Do NOT include phrases like "Title suggestion:", "Suggested title:", or any other prefixes
- Do NOT use quotes around the title
- Just return the plain title text`,
} as const;

export function LMStudioGenAI(database: Database, lmStudioHost: string, model: string): GenAI {
  console.log('LMStudioGenAI using host:', lmStudioHost, 'model:', model);
  const openai = new OpenAI({ baseURL: lmStudioHost, apiKey: "" });
  return {
    suggestVideoTitle: async (filename: string) => {
      const existingVideos = await database.listVideos();
      const existingTitles = existingVideos.map(v => v.title).slice(0, 100);
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          systemPrompt,
          {
            role: 'user',
            content: `Filename: ${filename}.
    Existing video titles in the library:
    ${existingTitles.length > 0 ? existingTitles.map(t => `- ${t}`).join('\n') : '(No existing videos yet)'}`,
          }
        ],
        temperature: 0.7,
        // 推論モデル（lfm2.5-8b-a1b 等）は reasoning_content にトークンを費やすため、
        // 100 では推論で使い切り content が空になる。十分な余裕を持たせる。
        max_tokens: 1000
      });
      // 切り捨て等で content が空のときは undefined を返し、呼び出し側で失敗を顕在化させる
      // （空文字をそのまま返すとフロントにサジェストが表示されず、原因が分からなくなる）。
      return completion.choices[0]?.message?.content?.trim() || undefined;
    }
  } satisfies GenAI;
}
