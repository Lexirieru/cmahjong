/**
 * Mapping of tile kind (0..33) to SVG files in /public/tiles.
 * Encoding matches the backend engine:
 *   0..8 man · 9..17 pin · 18..26 sou · 27..30 winds E,S,W,N · 31..33 dragons white,green,red
 */
const MAN = ["Man1", "Man2", "Man3", "Man4", "Man5", "Man6", "Man7", "Man8", "Man9"];
const PIN = ["Pin1", "Pin2", "Pin3", "Pin4", "Pin5", "Pin6", "Pin7", "Pin8", "Pin9"];
const SOU = ["Sou1", "Sou2", "Sou3", "Sou4", "Sou5", "Sou6", "Sou7", "Sou8", "Sou9"];
const HONORS = ["Ton", "Nan", "Shaa", "Pei", "Haku", "Hatsu", "Chun"];

export function tileFile(kind: number): string {
  if (kind < 9) return MAN[kind];
  if (kind < 18) return PIN[kind - 9];
  if (kind < 27) return SOU[kind - 18];
  return HONORS[kind - 27];
}

export function tileSrc(kind: number): string {
  return `/tiles/${tileFile(kind)}.svg`;
}

export const TILE_BACK = "/tiles/Back.svg";

const HONOR_LABEL = ["East", "South", "West", "North", "White", "Green", "Red"];

/** Concise label for accessibility / tooltip. */
export function tileLabel(kind: number): string {
  if (kind < 27) {
    const suit = kind < 9 ? "man" : kind < 18 ? "pin" : "sou";
    return `${(kind % 9) + 1} ${suit}`;
  }
  return HONOR_LABEL[kind - 27];
}
