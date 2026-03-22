/**
 * Generates a deterministic geometric avatar SVG (identicon-style) for a project.
 * The project path is hashed to produce a unique hue and symmetric 5x5 grid pattern.
 */
export function generateProjectAvatar(seed: string): string {
  // djb2-ish hash
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0;
  }
  const h = (hash >>> 0);

  // Derive hue from hash
  const hue = h % 360;
  const color = `hsl(${hue}, 50%, 55%)`;
  const bg = `hsl(${hue}, 30%, 15%)`;

  // 5x5 grid, mirrored horizontally (3 unique columns → 5)
  let bits = h;
  const grid: boolean[][] = [];
  for (let row = 0; row < 5; row++) {
    grid[row] = [];
    for (let col = 0; col < 3; col++) {
      bits = ((bits * 16807) + 1) & 0x7fffffff; // LCG
      grid[row][col] = bits % 3 !== 0; // ~66% fill rate
    }
    grid[row][3] = grid[row][1]; // mirror
    grid[row][4] = grid[row][0]; // mirror
  }

  // Build SVG with padding (4px inset on a 40x40 viewBox → 32x32 grid area)
  const pad = 6;
  const cellSize = (40 - pad * 2) / 5; // 5.6px per cell
  let rects = "";
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (grid[r][c]) {
        const x = pad + c * cellSize;
        const y = pad + r * cellSize;
        rects += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${color}"/>`;
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="${bg}"/><clipPath id="c"><circle cx="20" cy="20" r="20"/></clipPath><g clip-path="url(#c)">${rects}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
