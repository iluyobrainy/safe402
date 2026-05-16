export type Safe402HeaderMap = Record<string, string>;

export function getHeader(headers: Headers, names: string[]): string | null {
  for (const name of names) {
    const value = headers.get(name);
    if (value) {
      return value;
    }
  }

  return null;
}

export function headersToObject(headers: Headers): Safe402HeaderMap {
  const output: Safe402HeaderMap = {};

  headers.forEach((value, key) => {
    output[key.toLowerCase()] = value;
  });

  return output;
}

export function parseHeaderValueCandidates(value: string | null): unknown[] {
  if (!value) {
    return [];
  }

  const candidates: unknown[] = [];
  const trimmed = value.trim();

  pushParsed(candidates, trimmed);

  try {
    pushParsed(candidates, decodeURIComponent(trimmed));
  } catch {
    // Keep parsing best-effort; malformed URI escapes should not fail a probe.
  }

  for (const token of extractQuotedValues(trimmed)) {
    pushParsed(candidates, token);
  }

  for (const token of extractJsonObjects(trimmed)) {
    pushParsed(candidates, token);
  }

  return candidates;
}

export function parseWwwAuthenticateParameters(value: string | null): Record<string, string> {
  if (!value) {
    return {};
  }

  const output: Record<string, string> = {};
  const pattern = /([A-Za-z][A-Za-z0-9_-]*)=("([^"]*)"|[^,\s]+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    output[match[1].toLowerCase()] = match[3] ?? match[2];
  }

  return output;
}

function pushParsed(candidates: unknown[], value: string) {
  const parsedJson = parseJson(value);
  if (parsedJson !== undefined) {
    candidates.push(parsedJson);
    return;
  }

  const parsedBase64 = decodeBase64Json(value);
  if (parsedBase64 !== undefined) {
    candidates.push(parsedBase64);
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function decodeBase64Json(value: string): unknown {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    return parseJson(globalThis.atob(normalized));
  } catch {
    return undefined;
  }
}

function extractQuotedValues(value: string): string[] {
  const values: string[] = [];
  const pattern = /"([^"]+)"/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    values.push(match[1]);
  }

  return values;
}

function extractJsonObjects(value: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(value.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}
