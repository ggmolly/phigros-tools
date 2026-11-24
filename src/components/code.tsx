// lua's comments, strings, keywords, numbers and the names called, in that order: the first that matches wins, so a
// keyword in a string stays the string's. long brackets ([[ ]], [==[ ]==]) end on the same number of =
const TOKENS =
  /(--\[(=*)\[[\s\S]*?\]\2\]|--[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\[(=*)\[[\s\S]*?\]\4\])|\b(and|break|do|else|elseif|end|false|for|function|goto|if|in|local|nil|not|or|repeat|return|then|true|until|while)\b|\b(0x[\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\b|([A-Za-z_]\w*)(?=\s*[({"'])/g;

/** Lua code with its parts coloured (styles/mods.css), the rest as it is. */
export function Lua({ code }: { code: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of code.matchAll(TOKENS)) {
    const kind = match[1]
      ? "comment"
      : match[3]
        ? "string"
        : match[5]
          ? "keyword"
          : match[6]
            ? "number"
            : "call";
    parts.push(code.slice(last, match.index));
    parts.push(
      <span key={match.index} className={`lua-${kind}`}>
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  parts.push(code.slice(last));
  return parts;
}
