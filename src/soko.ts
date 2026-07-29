// Sokoban — the hand-built boulder floors of the branch off depth 9.
//
// Template glyphs (see Level.loadSokoban):
//   #  wall          .  floor         _  chasm (impassable until filled)
//   O  boulder       <  entry/exit    >  the way on (or the prize, on the last floor)
//   a b c d  weight plate     A B C D  the gate that plate holds open
//
// Two rules make these puzzles work, and both are enforced in the engine:
//   * shoving a boulder into a chasm CONSUMES it and leaves floor — so a wasted boulder is gone
//   * movement here is orthogonal only (NetHack's own Sokoban rule)
//
// Every level below carries a solution that the test suite replays through the real push rule
// (`tryPush` in level.ts). If anyone edits a template, the test fails — these are not levels you
// can safely tweak by eye. The solutions were produced by a breadth-first solver, so they are
// also the shortest possible; they are a correctness fixture, not a hint system.
//
// The co-op set additionally requires TWO adventurers, and that is a proven property rather than
// a design intention: a plate is held down by a body and never by a boulder, and the solver
// confirms each co-op floor is unsolvable by a lone player. Note the gates only ever guard the
// *work* — once the chasms are bridged, the way out is open with no plate held, so whoever
// leaves last is never stranded (players take the stairs independently).

export interface SokoLevel {
  readonly name: string;
  readonly rows: readonly string[];
  /** Solo: space-separated `h`/`j`/`k`/`l`. Co-op: `<player><dir>`, e.g. `1l` = guest steps east. */
  readonly solution: string;
}

export const SOKOBAN_SOLO: readonly SokoLevel[] = [
  {
    name: "the First Chasm",
    rows: [
      "#########",
      "#<......#",
      "#.#####.#",
      "#.#>#...#",
      "#.#_#...#",
      "#...#...#",
      "#..O#...#",
      "#.......#",
      "#########",
    ],
    solution: "j j j j j j l l k k k k",
  },
  {
    name: "the Narrow Ledge",
    rows: [
      "##########",
      "#<.......#",
      "#.######.#",
      "#.#....#.#",
      "#.#.>O.#.#",
      "#.#.__.#.#",
      "#.#....#.#",
      "#.###O##.#",
      "#........#",
      "##########",
    ],
    solution: "j j j j j j j l l l l k k k k h",
  },
  {
    name: "the Two Wells",
    rows: [
      "###########",
      "#<...#....#",
      "#....#.O..#",
      "#..O.#....#",
      "#...._....#",
      "#....#....#",
      "#..#._....#",
      "#..#.#...>#",
      "###########",
    ],
    solution: "j l l j h j l l l l j j j l l l",
  },
  {
    name: "the Sunken Gallery",
    rows: [
      "##############",
      "#<...#....#..#",
      "#....#....#..#",
      "#..O.#..O.#..#",
      "#....#....#..#",
      "#...._...._..#",
      "#....#....#..#",
      "#....#....#.>#",
      "##############",
    ],
    solution: "j l l j j h j l l l l k k k l l j j h j l l l l j j l",
  },
];

export const SOKOBAN_COOP: readonly SokoLevel[] = [
  {
    name: "the Warded Door",
    rows: [
      "###########",
      "#<...#....#",
      "#.a..A....#",
      "#....#....#",
      "#....#....#",
      "#...._O...#",
      "#....#...>#",
      "###########",
    ],
    solution: "0l 0j 0l 0l 1l 0l 0l 0j 0j 0l 0j 0h",
  },
  {
    name: "the Twin Locks",
    rows: [
      "#############",
      "#<.......a..#",
      "##A#.########",
      "#..O_########",
      "####.########",
      "#........b..#",
      "########.#B##",
      "########_O.##",
      "########.####",
      "#.......>...#",
      "#############",
    ],
    solution: "1l 0l 1l 1l 1l 1l 1l 1l 0j 0j 0l 0l 0j 0j 0l 0l 0l 0l 0l 0l 1h 1h 1h 1h 1h 1j 1j 1j 1j 1l 1l 1l 1l 1l 0j 0j 0h",
  },
  {
    name: "the Wasted Stone",
    rows: [
      "##############",
      "#<........a..#",
      "##A#.#########",
      "#..O_#########",
      "#..O.#########",
      "####.#########",
      "#........b...#",
      "#####.####B###",
      "#####_...O...#",
      "#####.########",
      "#....>########",
      "##############",
    ],
    solution: "1l 0l 1l 1l 1l 1l 1l 1l 1l 0j 0j 0l 0l 0j 0j 0j 0l 0l 0l 0l 0l 0l 1h 1h 1h 1h 1h 1h 1j 1j 1j 1j 1j 1l 1l 1l 1l 1l 0j 0j 0h 0h 0h 0h",
  },
  {
    name: "the Three Wards",
    rows: [
      "###############",
      "#<.........a..#",
      "##A#.##########",
      "#..O_##########",
      "####.##########",
      "#........b....#",
      "##########.#B##",
      "##########_O.##",
      "##########.####",
      "#....c........#",
      "##C#.##########",
      "#..O_##########",
      "#..O.##########",
      "####.##########",
      "#....>#########",
      "###############",
    ],
    solution: "1l 0l 1l 1l 1l 1l 1l 1l 1l 1l 0j 0j 0l 0l 0j 0j 0l 0l 0l 0l 0l 0l 0l 0l 1h 1h 1h 1h 1h 1h 1h 1j 1j 1j 1j 1l 1l 1l 1l 1l 0j 0j 0h 0h 0j 0j 0h 0h 0h 0h 0h 0h 0h 0h 1l 1j 1j 1j 1j 1h 1h 1h 1h 1h 0j 0j 0l",
  },
];

/** The floor set for the run's mode. Co-op floors need two bodies and cannot be cleared alone. */
export function sokobanSet(coop: boolean): readonly SokoLevel[] {
  return coop ? SOKOBAN_COOP : SOKOBAN_SOLO;
}
