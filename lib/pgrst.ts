// Safe building blocks for PostgREST filter strings (`.or(...)`, `.filter(...)`).
// A value is always wrapped in double quotes with \ and " escaped, so commas, parentheses,
// dots and quotes in user input cannot end the value and add new conditions.

/** Quote one value for use inside a PostgREST logic/filter expression. */
export const pgQuote = (v: string) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/** Remove LIKE wildcards (and PostgREST's * alias) from a search term so it matches literally. */
export const likeTerm = (v: string) => String(v).replace(/[%*_\\]/g, ' ').trim().slice(0, 100);

/** `col.ilike."*term*"` with the term made safe. Column names must come from code, never from input. */
export const ilikeHas = (col: string, term: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(col)) throw new Error('bad column');
  return `${col}.ilike.${pgQuote('*' + likeTerm(term) + '*')}`;
};

/** Escape LIKE wildcards for `.ilike(col, value)` when an exact (case-insensitive) match is meant. */
export const likeExact = (v: string) => String(v).replace(/[\\%_]/g, (c) => '\\' + c);

export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
