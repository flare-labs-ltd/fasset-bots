import { read } from "read";

export async function promptForPassword(promptToDisplay: string): Promise<string> {
  const secret = await read({
    prompt: promptToDisplay,
    silent: true,
    replace: "*"
  });
  return secret;
}

export function isJSON(content: string): boolean {
    return content.trim().startsWith('{');
}