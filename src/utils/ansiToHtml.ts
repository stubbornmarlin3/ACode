/** Convert ANSI SGR escape sequences to HTML spans with inline styles. */

const BASIC_FG: Record<number, string> = {
  30: "#0a0f16", 31: "#ef4444", 32: "#22c55e", 33: "#eab308",
  34: "#3b82f6", 35: "#a855f7", 36: "#06b6d4", 37: "#e8edf2",
  90: "#4a5568", 91: "#f87171", 92: "#4ade80", 93: "#facc15",
  94: "#60a5fa", 95: "#c084fc", 96: "#22d3ee", 97: "#f8fafc",
};

const BASIC_BG: Record<number, string> = {
  40: "#0a0f16", 41: "#ef4444", 42: "#22c55e", 43: "#eab308",
  44: "#3b82f6", 45: "#a855f7", 46: "#06b6d4", 47: "#e8edf2",
  100: "#4a5568", 101: "#f87171", 102: "#4ade80", 103: "#facc15",
  104: "#60a5fa", 105: "#c084fc", 106: "#22d3ee", 107: "#f8fafc",
};

// 256-color palette: 0-7 standard, 8-15 bright, 16-231 color cube, 232-255 grayscale
function color256(n: number): string {
  if (n < 8) return Object.values(BASIC_FG)[n];
  if (n < 16) return Object.values(BASIC_FG)[n - 8 + 8]; // bright
  if (n < 232) {
    const idx = n - 16;
    const r = Math.floor(idx / 36);
    const g = Math.floor((idx % 36) / 6);
    const b = idx % 6;
    const map = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    return `rgb(${map(r)},${map(g)},${map(b)})`;
  }
  const gray = 8 + (n - 232) * 10;
  return `rgb(${gray},${gray},${gray})`;
}

interface Style {
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
}

function styleToAttrs(s: Style): string {
  const parts: string[] = [];
  if (s.fg) parts.push(`color:${s.fg}`);
  if (s.bg) parts.push(`background:${s.bg}`);
  if (s.bold) parts.push("font-weight:bold");
  if (s.dim) parts.push("opacity:0.6");
  if (s.italic) parts.push("font-style:italic");
  if (s.underline) parts.push("text-decoration:underline");
  return parts.join(";");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function ansiToHtml(raw: string): string {
  // Strip OSC sequences, charset switches, mode escapes, and control chars (except ESC)
  let input = raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[()][A-Z0-9]/g, "")
    .replace(/\x1b[>=<]/g, "")
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1a\x1c-\x1f]/g, "")
    .replace(/\r/g, "");

  const result: string[] = [];
  const style: Style = {};
  let i = 0;

  while (i < input.length) {
    // CSI sequence: ESC [ <params> <letter>
    if (input[i] === "\x1b" && input[i + 1] === "[") {
      // Find the terminating letter (0x40-0x7E)
      let end = i + 2;
      while (end < input.length && !/[A-Za-z@`~]/.test(input[end])) end++;
      if (end >= input.length) { i++; continue; }
      const terminator = input[end];
      // Only process SGR (ends with 'm'), skip all others (cursor movement, etc.)
      if (terminator !== "m") { i = end + 1; continue; }
      const params = input.slice(i + 2, end).split(";").map(Number);
      let p = 0;
      while (p < params.length) {
        const code = params[p];
        if (code === 0 || isNaN(code)) {
          delete style.fg; delete style.bg;
          delete style.bold; delete style.italic;
          delete style.underline; delete style.dim;
        } else if (code === 1) style.bold = true;
        else if (code === 2) style.dim = true;
        else if (code === 3) style.italic = true;
        else if (code === 4) style.underline = true;
        else if (code === 22) { delete style.bold; delete style.dim; }
        else if (code === 23) delete style.italic;
        else if (code === 24) delete style.underline;
        else if (code === 39) delete style.fg;
        else if (code === 49) delete style.bg;
        else if (BASIC_FG[code]) style.fg = BASIC_FG[code];
        else if (BASIC_BG[code]) style.bg = BASIC_BG[code];
        else if (code === 38 && params[p + 1] === 5) {
          style.fg = color256(params[p + 2] ?? 0); p += 2;
        } else if (code === 48 && params[p + 1] === 5) {
          style.bg = color256(params[p + 2] ?? 0); p += 2;
        } else if (code === 38 && params[p + 1] === 2) {
          style.fg = `rgb(${params[p+2]},${params[p+3]},${params[p+4]})`; p += 4;
        } else if (code === 48 && params[p + 1] === 2) {
          style.bg = `rgb(${params[p+2]},${params[p+3]},${params[p+4]})`; p += 4;
        }
        p++;
      }
      i = end + 1;
      continue;
    }

    // Skip any other ESC sequences we didn't catch
    if (input[i] === "\x1b") {
      i++;
      continue;
    }

    // Collect text run until next ESC
    let textEnd = input.indexOf("\x1b", i);
    if (textEnd === -1) textEnd = input.length;
    const text = input.slice(i, textEnd);
    if (text.length > 0) {
      const attrs = styleToAttrs(style);
      if (attrs) {
        result.push(`<span style="${attrs}">${escapeHtml(text)}</span>`);
      } else {
        result.push(escapeHtml(text));
      }
    }
    i = textEnd;
  }

  return result.join("");
}
