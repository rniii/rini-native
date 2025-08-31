const mines = {};
const board = [];

for (let i = 0; i < 10; i++) {
  const row = [];
  for (let j = 0; j < 10; j++) {
    row.push(Math.random() < 5 / 32 ? 9 : 0);
  }
  board.push(row);
}

for (let i = 0; i < 10; i++) {
  for (let j = 0; j < 10; j++) {
    if (board[i][j] == 9) continue;

    eachNeighbor(i, j, (x, y) => board[i][j] += board[x]?.[y] == 9);
  }
}

globalThis.print ??= console.log;

for (const row of board) {
  print(row.map(x => ` \x1b[${getColor(x)}m${x}\x1b[m|`).join(""));
  print("--+".repeat(10));
}

function eachNeighbor(u, v, f) {
  return [11, 12, 13, 21, 23, 31, 32, 33].forEach(c => {
    const [x, y] = `${c}`;
    f(u - x + 2, v - y + 2);
  });
}

function getColor(x) {
  if (x == 0) return "30";
  if (x == 9) return "0";
  if (x == 1) return "34";
  if (x == 2) return "32";

  return "31";
}
