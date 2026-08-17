import { MetadataStore } from '../metadata/MetadataStore';

export const TITLE_SYSTEM_PROMPT = `You are a helpful assistant that suggests clear, descriptive video titles based on filenames and existing naming patterns.
 Given a video filename and some existing video titles in the library, suggest a clear, descriptive title for the new video.

Instructions:
- Create a title that's descriptive and follows the naming pattern of existing videos (if any)
- The filename may be a romanized (romaji) form of a Japanese title; match it against the Japanese titles in the library to identify the series (e.g. "Nihongo no title - 02" belongs to the series titled "日本語のタイトル")
- Remove file extensions from the filename
- Capitalize appropriately
- Keep it concise but informative
- Return ONLY the suggested title itself, nothing else
- Do NOT include phrases like "Title suggestion:", "Suggested title:", or any other prefixes
- Do NOT use quotes around the title
- Just return the plain title text`;

export async function buildTitleUserPrompt(metadata: MetadataStore, filename: string): Promise<string> {
  const existing = await metadata.list();
  const titles = existing.map((v) => v.title);
  return `Filename: ${filename}.
    Existing video titles in the library:
    ${titles.length > 0 ? titles.map((t) => `- ${t}`).join('\n') : '(No existing videos yet)'}`;
}
