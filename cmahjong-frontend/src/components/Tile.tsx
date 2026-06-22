"use client";

import { TILE_BACK, tileLabel, tileSrc } from "@/lib/tiles";

interface TileProps {
  kind?: number; // undefined + faceDown -> tile back
  width?: number; // px
  faceDown?: boolean;
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
}

/** A single mahjong tile (SVG) with tactile tile depth. */
export function Tile({ kind, width = 38, faceDown, selected, dim, onClick }: TileProps) {
  const height = Math.round(width * 1.34);
  const src = faceDown || kind === undefined ? TILE_BACK : tileSrc(kind);
  const interactive = !!onClick;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      aria-label={kind !== undefined && !faceDown ? tileLabel(kind) : "tile"}
      style={{ width, height }}
      className={[
        "relative shrink-0 rounded-[7px] bg-ivory p-[2px]",
        "shadow-[0_2px_0_rgba(0,0,0,0.35),0_4px_8px_rgba(0,0,0,0.3)]",
        "transition-transform duration-150",
        selected ? "-translate-y-2 ring-2 ring-gold-400" : "",
        dim ? "opacity-45" : "",
        interactive ? "active:translate-y-[1px] hover:-translate-y-0.5" : "cursor-default",
      ].join(" ")}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" draggable={false} className="h-full w-full select-none object-contain" />
    </button>
  );
}
