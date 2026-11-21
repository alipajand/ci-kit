/**
 * Minimal glob matching for repository paths (always `/`-separated, relative to the root).
 *
 * - `**` matches any number of path segments, including none (`docs/**` matches `docs/a/b.md`).
 * - `*` matches within one segment (`*.md` matches `README.md`, not `docs/README.md`).
 * - `?` matches one character other than `/`.
 * - A pattern without `/` other than a trailing one matches at the root only, as in `.gitignore`
 *   anchoring: write `** /name` (without the space) to match at any depth.
 * - A trailing `/` means "everything under this directory" (`docs/` is `docs/**`).
 */

const cache = new Map();

/** The regular expression for one glob pattern. */
export function globToRegExp(pattern) {
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new TypeError(`invalid glob pattern: ${JSON.stringify(pattern)}`);
  }
  const cached = cache.get(pattern);
  if (cached) {
    return cached;
  }
  const source = pattern.endsWith("/") ? `${pattern}**` : pattern;
  let out = "";
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "*") {
      if (source[i + 1] === "*") {
        // `**/` (any depth, including none) or a trailing `**` (anything below).
        if (source[i + 2] === "/") {
          out += "(?:[^/]+/)*";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  const re = new RegExp(`^${out}$`);
  cache.set(pattern, re);
  return re;
}

/** Whether `path` matches any of `patterns`. */
export const matchesAny = (patterns, path) => (patterns ?? []).some((pattern) => globToRegExp(pattern).test(path));
