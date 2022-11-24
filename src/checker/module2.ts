import { Type } from "./types2"
import { Vector, vm } from "./utils"
import { eatWhitespace } from '../utf'

export class ModuleSubroutine {
    exported = false
    result?: Type
    narrowed?: Type // when control flow analysis sets a new value
  constructor(
    public name: string,
    public address: number,
    public flags: number,
    public main = false
  ) {}
}
interface FoundSourceMap { 
    pos: number; 
    end: number
}
interface FoundSourceLineCharacter {
    line: number
    pos: number
    end: number
}
function foundSourceMap(map: FoundSourceMap) {
    return map.pos !== 0 && map.end !== 0
}
function omitWhitespace(code: string, map: FoundSourceMap) {
    map.pos = eatWhitespace(code, map.pos)
}
export class DiagnosticMessage {
    module?: Module
    constructor( public message = "", public ip = 0) {}
}
export class Module {
  subroutines: ModuleSubroutine[] = [];
  sourceMapAddress = 0;
  sourceMapAddressEnd = 0;
  errors: DiagnosticMessage[] = [];
  constructor(
    public bin = new Vector(),
    public fileName = "index.ts",
    public code = ""
  ) {}
  clear() {
    this.errors = [];
    this.subroutines = [];
  }
  // TODO: these accessor are all longer than direct accessk
  getSubroutine(index: number) {
    return this.subroutines[index];
  }
  getMain() {
    return this.subroutines.at(-1);
  }
  findIdentifier(ip: number) {
    const map = this.findNormalizedMap(ip);
    if (!foundSourceMap(map)) return "";
    return this.code.slice(map.pos, map.end);
  }
  findMap(ip: number): FoundSourceMap {
    let found = 0;
    for (let i = this.sourceMapAddress; i < this.sourceMapAddressEnd; i++) {
      const mapIp = vm.readUint32(this.bin, i);
      if (mapIp === ip) {
        found = i;
        break;
      }
    }
    if (found) {
      return {
        pos: vm.readUint32(this.bin, found + 4),
        end: vm.readUint32(this.bin, found + 8),
      };
    }
    return { pos: 0, end: 0 };
  }
  findNormalizedMap(ip: number) {
    const map = this.findMap(ip);
    if (foundSourceMap(map)) omitWhitespace(this.code, map);
    return map;
  }
  mapToLineCharacter(map: FoundSourceMap): FoundSourceLineCharacter {
    let line = 0;
    let pos = 0;
    while (pos < map.pos) {
      let lineStart = this.code.indexOf("\n");
      if (lineStart === -1)
        return { line, pos: map.pos - pos, end: map.end - pos };
      else if (lineStart > map.pos)
        // don't overshoot
        break;
      pos = lineStart + 1;
      line++;
    }
    return { line, pos: map.pos - pos, end: map.end - pos };
  }
  printErrors() {
    for (const e of this.errors) {
        if (e.ip) {
            const map = this.findNormalizedMap(e.ip)
            if (foundSourceMap(map)) {
                let lineStart = this.code.lastIndexOf("\n", map.pos)
                lineStart = lineStart === -1 ? 0 : lineStart + 1

                let lineEnd = this.code.indexOf('\n', map.end)
                if (lineEnd === -1) lineEnd = this.code.length
                console.log(`${this.fileName}:${map.pos}:${map.end} - error TS0000: ${e.message}\n\n`)
                console.log(">>" + this.code.slice(lineStart, lineEnd) + '\n')
                const space = map.pos - lineStart
                console.log(">>" + " ".repeat(space) + "^".repeat(map.end - map.pos) + "\n\n")
            }
        }
        console.log(" " + e.message) + '\n')
    }
    console.log("Found " + this.errors.length + " errors in " + this.fileName)
  }
}