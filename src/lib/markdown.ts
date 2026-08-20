import { remark } from "remark";
import remarkHtml from "remark-html";

/**
 * Render user-supplied markdown to HTML on the server. remark-html escapes raw
 * HTML by default, preventing it from becoming executable page markup.
 */
export async function renderMarkdown(md: string | null): Promise<string> {
  if (!md) return "";
  const file = await remark().use(remarkHtml).process(md);
  return String(file);
}
