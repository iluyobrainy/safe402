export type Safe402ResponseBodySnapshot = {
  text: string;
  json?: unknown;
  contentType: string;
};

export async function readResponseBody(response: Response): Promise<Safe402ResponseBodySnapshot> {
  const clone = response.clone();
  const contentType = clone.headers.get("content-type") ?? "";
  const text = await clone.text().catch(() => "");
  const json = parseJson(text);

  return {
    text,
    json,
    contentType
  };
}

export function collectCandidateObjects(value: unknown): unknown[] {
  const candidates: unknown[] = [];
  visit(value, candidates, 0);
  return candidates;
}

function visit(value: unknown, candidates: unknown[], depth: number) {
  if (depth > 6 || value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      visit(item, candidates, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  candidates.push(value);

  for (const nested of Object.values(value as Record<string, unknown>)) {
    visit(nested, candidates, depth + 1);
  }
}

function parseJson(value: string): unknown {
  if (!value.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
