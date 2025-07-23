import { transpose } from "./utils";

export const ansiColor = (c?: number) => `\x1b[${c ?? ""}m`;
export const rgbColor = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
export const RED = ansiColor(31);
export const GREEN = ansiColor(32);
export const YELLOW = ansiColor(33);
export const BLUE = ansiColor(34);
export const PURPLE = ansiColor(35);
export const CYAN = ansiColor(36);
export const LIGHT_RED = ansiColor(91);
export const LIGHT_GREEN = ansiColor(92);
export const LIGHT_YELLOW = ansiColor(93);
export const LIGHT_BLUE = ansiColor(94);
export const LIGHT_PURPLE = ansiColor(95);
export const LIGHT_CYAN = ansiColor(95);
export const RESET = ansiColor();

const enum GutterTileType {
  EMPTY = 0,
  TOP = 1 << 0,
  RIGHT = 1 << 1,
  BOTTOM = 1 << 2,
  LEFT = 1 << 3,
  X = LEFT | RIGHT,
  Y = TOP | BOTTOM,
  CORNER_TOP = BOTTOM | RIGHT,
  CORNER_BOTTOM = TOP | RIGHT,
}

const SPRITES = [
  [" ", "╵", "╶", "└"],
  ["╷", "│", "┌", "├"],
  ["╴", "┘", "─", "┴"],
  ["┐", "┤", "┬", "┼"],
].flat().join("");

const CURVED: Record<string, string> = {
  "┌": "╭",
  "┐": "╮",
  "┘": "╯",
  "└": "╰",
}

export type GutterTile =
  | {
    type: GutterTileType.EMPTY;
    dest?: number;
  }
  | {
    type: Exclude<GutterTileType, GutterTileType.EMPTY>;
    dest: number;
  };

export type Pointer = { from: number; to: number };
export type GutterOptions = {
  colors?: boolean;
  curved?: boolean;
};

export function drawGutter(length: number, pointers: Pointer[], opts: GutterOptions = {}): string[] {
  if (length === 0) return [];
  if (pointers.length === 0) return Array(length).fill("");

  const lanes: GutterTile[][] = [];

  const createLane = () => Array.from({ length }, () => ({ type: GutterTileType.EMPTY } as const));

  const ends: GutterTile[] = createLane();

  function canUseLane(laneIdx: number, pointer: Pointer) {
    if (laneIdx >= lanes.length) {
      for (let i = 0; i < laneIdx + 1 - lanes.length; i++) lanes.push(createLane());
      return true;
    }

    const lane = lanes[laneIdx];

    if (lane[pointer.from].dest === pointer.to) return true;
    // if (ends[pointer.from].type !== GutterTileType.EMPTY) throw new Error("Recursive pointer");

    const delta = Math.sign(pointer.to - pointer.from);
    for (let y = pointer.from; y !== pointer.to; y += delta) {
      const tile = lane[y];
      if (tile.type === GutterTileType.EMPTY) continue;
      if (tile.type === GutterTileType.X) {
        if (tile.dest === pointer.to) return true;
        continue;
      }

      if (tile.dest !== pointer.to) return false;
    }

    return true;
  }

  function drawPointer(laneIdx: number, pointer: Pointer) {
    const lane = lanes[laneIdx];

    const delta = Math.sign(pointer.to - pointer.from);
    const forwards = delta === 1 ? GutterTileType.BOTTOM : GutterTileType.TOP;
    const backwards = delta === 1 ? GutterTileType.TOP : GutterTileType.BOTTOM;

    if (ends[pointer.from].type === GutterTileType.EMPTY) {
      ends[pointer.from] = {
        type: GutterTileType.X,
        dest: pointer.to,
      };
    }

    for (let x = 0; x <= laneIdx; x++) {
      if (lanes[x][pointer.from].type === GutterTileType.Y) {
        if (lanes[x][pointer.from].dest === pointer.to) {
          lanes[x][pointer.from].type |= GutterTileType.RIGHT;
          return;
        }
        continue;
      }
      if (lanes[x][pointer.from].type !== GutterTileType.EMPTY) continue;
      lanes[x][pointer.from] = {
        type: GutterTileType.X,
        dest: pointer.to,
      };
    }

    if (pointer.from === pointer.to) return;

    lane[pointer.from] = {
      type: forwards | GutterTileType.RIGHT,
      dest: pointer.to,
    };

    for (let y = pointer.from + delta; y != pointer.to; y += delta) {
      if (lane[y].dest === pointer.to) {
        lane[y].type |= backwards;
        return;
      }
      if (lane[y].type === GutterTileType.X) continue;
      if (lane[y].type !== GutterTileType.EMPTY) continue;
      lane[y] = {
        type: GutterTileType.Y,
        dest: pointer.to,
      };
    }

    lane[pointer.to] = {
      type: backwards | GutterTileType.RIGHT,
      dest: pointer.to,
    };

    for (let x = laneIdx - 1; x >= 0; x--) {
      if (lanes[x][pointer.to].type !== GutterTileType.EMPTY) continue;
      lanes[x][pointer.to] = {
        type: GutterTileType.X,
        dest: pointer.to,
      };
    }

    if (ends[pointer.to].type === GutterTileType.EMPTY) {
      ends[pointer.to] = {
        type: GutterTileType.X,
        dest: pointer.to,
      };
    }
  }

  const colorPool = [
    rgbColor(228, 103, 147),
    rgbColor(230, 113, 54),
    rgbColor(190, 144, 52),
    rgbColor(105, 172, 59),
    rgbColor(85, 182, 155),
    rgbColor(75, 169, 225),
    rgbColor(113, 143, 250),
    rgbColor(188, 117, 219),
  ];
  const colors: Record<number, string> = {};

  function getNextColor() {
    let color = colorPool.shift()!;
    colorPool.push(color);
    return color;
  }
  function getColor(dest: number) {
    colors[dest] ??= getNextColor();
    return colors[dest];
  }

  function drawTile(tile: GutterTile, sprite = SPRITES[tile.type]) {
    if (opts.curved) sprite = CURVED[sprite] ?? sprite
    if (opts.colors && tile.dest != null) {
      sprite = getColor(tile.dest) + sprite + RESET;
    }
    return sprite;
  }

  function drawLineEnd(lineIdx: number) {
    const tile = ends[lineIdx];
    if (tile.dest !== lineIdx) return drawTile(tile);

    if (lanes[0][lineIdx].type & GutterTileType.RIGHT) return drawTile(tile, ">");
    return drawTile(tile, "→");
  }

  for (const pointer of pointers) {
    let laneIdx = 0;
    while (!canUseLane(laneIdx, pointer)) laneIdx++;

    drawPointer(laneIdx, pointer);
  }

  return transpose(lanes).map((line, lineIdx) =>
    line.map((tile) => drawTile(tile)).toReversed().join("") + drawLineEnd(lineIdx)
  );
}
