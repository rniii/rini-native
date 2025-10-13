export { ModuleBytecode, type ModuleFunction, type PartialFunctionHeader } from "./function.ts";
export { Instruction, isValidOpcode, type ParsedArguments, type ParsedInstruction, type RawArguments, type RawInstruction } from "./instruction.ts";
export { type Literal } from "./literalParser.ts";
export { BigIntTable, HermesModule, RegExpTable, StringTable, type UniqueString } from "./module.ts";
