/**
 * A deliberately small reader for GitHub Actions workflow files: enough structure for the lint
 * rules (top-level keys, triggers, jobs and their keys, `uses:` lines and steps), with line numbers.
 * It is not a YAML parser. It expects block-style YAML with consistent indentation, as Prettier
 * and every GitHub example write it; anchors, aliases and flow-style mappings for jobs are not
 * read. A file it can't read yields no jobs, and the plan-wiring rules then report the missing
 * jobs rather than passing silently.
 */

const indentOf = (line) => line.length - line.trimStart().length;
const isBlank = (line) => line.trim() === "" || line.trimStart().startsWith("#");
const unquote = (key) => key.replace(/^["']|["']$/g, "");
const stripComment = (value) => value.replace(/\s+#.*$/, "").trim();

/** Keys at `indent` within lines[start, end): name → { line (0-based), value }. */
function keysAt(lines, start, end, indent) {
  const keys = new Map();
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (isBlank(line) || indentOf(line) !== indent) {
      continue;
    }
    const match = line.trimStart().match(/^("[^"]+"|'[^']+'|[A-Za-z_][\w.-]*):(?:\s+(.*))?$/);
    if (!match) {
      continue;
    }
    const rest = [];
    let j = i + 1;
    while (j < end && (isBlank(lines[j]) || indentOf(lines[j]) > indent)) {
      rest.push(lines[j]);
      j++;
    }
    while (rest.length > 0 && isBlank(rest[rest.length - 1])) {
      rest.pop();
    }
    keys.set(unquote(match[1]), {
      line: i,
      end: j,
      inline: stripComment(match[2] ?? ""),
      block: rest.join("\n"),
    });
  }
  return keys;
}

/** The first indent used below lines[start], within [start, end). */
function childIndent(lines, start, end) {
  for (let i = start; i < end; i++) {
    if (!isBlank(lines[i])) {
      return indentOf(lines[i]);
    }
  }
  return -1;
}

/** A key's whole value as one string: the inline part and any continuation lines. */
export const valueOf = (entry) => (entry ? [entry.inline, entry.block].filter(Boolean).join("\n").trim() : "");

/** The job ids in a `needs:` value: a scalar, a flow list (one or many lines) or a block list. */
export function needsList(entry) {
  if (!entry) {
    return [];
  }
  const text = valueOf(entry)
    .split("\n")
    .map((line) => stripComment(line))
    .join("\n");
  if (text.startsWith("[")) {
    return text
      .replace(/^\[|\]$/g, "")
      .split(/[,\n]/)
      .map((item) => unquote(item.trim()))
      .filter(Boolean);
  }
  if (entry.inline) {
    return [unquote(entry.inline)];
  }
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => unquote(line.slice(2).trim()));
}

/**
 * @param {string} text
 * @returns {{ lines: string[], top: Map<string, object>, triggers: Set<string>,
 *   triggerTypes: Map<string, string[]>, jobs: { id: string, line: number, keys: Map<string, object>,
 *   start: number, end: number }[] }}
 */
export function readWorkflow(text) {
  const lines = text.split("\n");
  const top = keysAt(lines, 0, lines.length, 0);
  // YAML 1.1 reads a bare `on` key as `true`; GitHub accepts both spellings.
  const on = top.get("on") ?? top.get("true");
  const triggers = new Set();
  const triggerTypes = new Map();
  if (on) {
    if (on.inline.startsWith("[")) {
      for (const name of on.inline.replace(/^\[|\]$/g, "").split(",")) {
        triggers.add(name.trim());
      }
    } else if (on.inline) {
      triggers.add(on.inline);
    } else {
      const indent = childIndent(lines, on.line + 1, on.end);
      if (indent >= 0) {
        for (const [name, entry] of keysAt(lines, on.line + 1, on.end, indent)) {
          triggers.add(name);
          const inner = childIndent(lines, entry.line + 1, entry.end);
          const types = inner >= 0 ? keysAt(lines, entry.line + 1, entry.end, inner).get("types") : null;
          if (types) {
            triggerTypes.set(name, needsList(types));
          }
        }
      } else {
        for (const line of on.block.split("\n")) {
          const item = line.trim();
          if (item.startsWith("- ")) {
            triggers.add(item.slice(2).trim());
          }
        }
      }
    }
  }

  const jobs = [];
  const jobsEntry = top.get("jobs");
  if (jobsEntry) {
    const jobIndent = childIndent(lines, jobsEntry.line + 1, jobsEntry.end);
    if (jobIndent > 0) {
      const headers = [...keysAt(lines, jobsEntry.line + 1, jobsEntry.end, jobIndent)];
      for (const [id, entry] of headers) {
        const keyIndent = childIndent(lines, entry.line + 1, entry.end);
        jobs.push({
          id,
          line: entry.line,
          start: entry.line,
          end: entry.end,
          keys: keyIndent > jobIndent ? keysAt(lines, entry.line + 1, entry.end, keyIndent) : new Map(),
        });
      }
    }
  }
  return { lines, top, triggers, triggerTypes, jobs };
}

/** Every `uses:` line: { line (0-based), ref }. */
export function usesLines(lines) {
  const found = [];
  lines.forEach((line, i) => {
    const match = line.match(/^\s*(?:-\s+)?uses:\s*["']?([^\s"'#]+)/);
    if (match) {
      found.push({ line: i, ref: match[1] });
    }
  });
  return found;
}

/** The lines of the step holding lines[index]: from its `- ` line to the next step or less indent. */
export function stepAround(lines, index) {
  let start = index;
  while (start > 0 && !lines[start].trimStart().startsWith("- ")) {
    start--;
  }
  const dash = indentOf(lines[start]);
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (!isBlank(line) && (indentOf(line) < dash || (indentOf(line) === dash && line.trimStart().startsWith("- ")))) {
      break;
    }
    if (!isBlank(line) && indentOf(line) === dash) {
      break;
    }
    end++;
  }
  return lines.slice(start, end);
}
