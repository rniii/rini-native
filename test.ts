import { inspect } from "util";
import { Rope } from "./src/rope.ts";

let rope = new Rope("bar");

rope = rope.insert(0, new Rope("foo"));
rope = rope.remove(1, 3);
rope = rope.append(new Rope("t"));

console.log(inspect(rope, { colors: true, depth: 1 / 0 }));
console.log(Array.from(rope).join(""))
