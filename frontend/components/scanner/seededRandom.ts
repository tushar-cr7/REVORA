/**
 * Deterministic pseudo-random generator (mulberry32). The transaction
 * field's node positions are generated at render time, and Next.js
 * statically prerenders this client component at build time — a plain
 * Math.random() would produce a different layout on the server than on
 * the client, causing a hydration mismatch. Seeding it keeps the "random"
 * field identical on every render.
 */
export function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
