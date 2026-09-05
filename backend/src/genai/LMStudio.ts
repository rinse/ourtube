import OpenAI from 'openai';
import { GenAI } from './GenAI';
import { MetadataStore } from '../metadata/MetadataStore';
import { TITLE_SYSTEM_PROMPT, buildTitleUserPrompt } from './prompt';

export function LMStudioGenAI(metadata: MetadataStore, lmStudioHost: string, model: string): GenAI {
  console.log('LMStudioGenAI using host:', lmStudioHost, 'model:', model);
  const openai = new OpenAI({ baseURL: lmStudioHost, apiKey: '' });
  return {
    suggestVideoTitle: async (filename: string, playlistTitles: string[]) => {
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: TITLE_SYSTEM_PROMPT },
          { role: 'user', content: await buildTitleUserPrompt(metadata, filename, playlistTitles) },
        ],
        temperature: 0.7,
        // 推論モデルは reasoning_content にトークンを費やすため、100 では
        // 推論で使い切り content が空になる。十分な余裕を持たせる。
        max_tokens: 1000,
      });
      // content が空のときは undefined を返し、呼び出し側で失敗を顕在化させる。
      return completion.choices[0]?.message?.content?.trim() || undefined;
    },
  } satisfies GenAI;
}
