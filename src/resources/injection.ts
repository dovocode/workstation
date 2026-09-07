import type { GeneratedFileResource } from "../api/types.js";

/** Validate an injection declaration and return its text and unique boundaries. */
function injectionData(resource: GeneratedFileResource): { start: string; end: string; content: string } {
  const value: unknown = resource.value;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !("start" in value) || !("end" in value) || !("content" in value) ||
      typeof value.start !== "string" || !value.start || typeof value.end !== "string" || !value.end ||
      value.start === value.end || typeof value.content !== "string" ||
      value.content.includes(value.start) || value.content.includes(value.end)) {
    throw new Error(`Invalid injection markers or content: ${resource.target}`);
  }
  return { start: value.start, end: value.end, content: value.content };
}

/** Locate one ordered pair of markers, rejecting missing or ambiguous boundaries. */
export function injectionRange(text: string, resource: GeneratedFileResource): [number, number] {
  const { start, end } = injectionData(resource);
  const left = text.indexOf(start);
  const right = text.indexOf(end);
  if (left < 0 || right < left + start.length || text.indexOf(start, left + 1) >= 0 || text.indexOf(end, right + 1) >= 0) {
    throw new Error(`Expected one ordered pair of injection markers in ${resource.target}`);
  }
  return [left + start.length, right];
}

/** Replace only bytes between the declared markers; caller supplies any desired newlines. */
export function injectContent(text: string, resource: GeneratedFileResource, replacement = injectionData(resource).content): string {
  const [start, end] = injectionRange(text, resource);
  return text.slice(0, start) + replacement + text.slice(end);
}
