import { Op } from "./instructions";

export class Vector {
  a = new Uint8Array(16);
  length = 0;
  resize(length: number) {
    if (length > this.a.length) {
      const resize = new Uint8Array(this.length * 2);
      resize.set(this.a);
      this.a = resize;
    }
  }
  push(n: number) {
    this.length++;
    this.resize(this.length);
    this.a[this.length] = n & 0xff;
  }
  append(v: Vector) {
    this.resize(this.length + v.length)
    this.a.set(v.a, this.length)
    this.length += v.length
  }
}
export namespace vm {
    // TODO: readUint64 is *never* going to work from a IEEE 754 number,
    //  but I bet it isn't used much
    // TODO: The calls in the first half of compiler.ts will have to be re-checked
    // And before that happens, I need to
    // 1. figure out how to emulate the enum <-> UInt8 interchange
    export function readUint64(bin: Vector, offset: number): number {
        // read 8 bits from bin and convert it to a number
        return (
          bin.a[offset] |
          (bin.a[offset + 1] << 8) |
          (bin.a[offset + 2] << 16) |
          (bin.a[offset + 3] << 24) |
          (bin.a[offset + 4] << 32) |
          (bin.a[offset + 5] << 40) |
          (bin.a[offset + 6] << 48) | // note: everything past 53 doesn't actually work
          (bin.a[offset + 7] << 56)
        );
    }
    export function readUint32(bin: Vector, offset: number): number {
        // read 8 bits from bin and convert it to a number
        return bin.a[offset] | bin.a[offset + 1] << 8 | bin.a[offset + 2] << 16 | bin.a[offset + 3] << 24
    }
    export function readUint16(bin: Vector, offset: number): number {
        return bin.a[offset] | (bin.a[offset + 1] << 8)
    }
    export function readStorage(bin: Vector, offset: number): string {
      const size = bin.a[offset]
      let s = ""
      for (let i = 0; i < size; i++) {
        s += String.fromCharCode(bin.a[offset + 1 + i])
      }
      return s
    }
    export function writeUint64(bin: Vector, offset: number, value: number) {
      bin.resize(offset + 8)
      bin.a[offset] = value & 0xff;
      bin.a[offset + 1] = value & 0xff00;
      bin.a[offset + 2] = value & 0xff0000;
      bin.a[offset + 3] = value & 0xff000000;
      bin.a[offset + 4] = value & 0xff00000000;
      bin.a[offset + 5] = value & 0xff0000000000;
      bin.a[offset + 6] = value & 0xff000000000000; // 2^53 is the max safe integer
      bin.a[offset + 7] = value & 0xff00000000000000;
    }
    export function writeUint32(bin: Vector, offset: number, value: number) {
      bin.resize(offset + 4)
      bin.a[offset] = value & 0xff;
      bin.a[offset + 1] = value & 0xff00;
      bin.a[offset + 2] = value & 0xff0000;
      bin.a[offset + 3] = value & 0xff000000;
      return bin.a
    }
    export function writeUint16(bin: Vector, offset: number, value: number) {
      bin.resize(offset + 2)
      bin.a[offset] = value & 0xff;
      bin.a[offset + 1] = value & 0xff00;
      return bin.a
    }
    export function eatParams(op: Op, i: number): number {
      switch (op) {
        case Op.TailCall:
        case Op.Call:
          return i + 6;
        case Op.Subroutine:
          return i + 4 + 4 + 1;
        case Op.Main:
          return i;
        case Op.Jump:
        case Op.JumpCondition:
          return i + 4;
        case Op.Distribute:
          return i + 2 + 4;
        case Op.Set:
        case Op.CheckBody:
        case Op.InferBody:
        case Op.SelfCheck:
        case Op.Inline:
        case Op.TypeArgumentDefault:
          return i + 4;
        case Op.ClassRef:
        case Op.FunctionRef:
          return i + 4;
        case Op.New:
        case Op.Instantiate:
        case Op.Error:
          return i + 2;
        case Op.Method:
        case Op.Function:
        case Op.Union:
        case Op.Tuple:
        case Op.TemplateLiteral:
        case Op.Class:
        case Op.ObjectLiteral:
        case Op.Slots:
        case Op.CallExpression:
          return i + 2;
        case Op.Loads:
        case Op.Parameter:
        case Op.NumberLiteral:
        case Op.BigIntLiteral:
        case Op.StringLiteral:
          return i + 4;
        default:
          return i;
      }
    }
    export function runtimeHash(input: string) {
      return input.length * 31 ^ 17; // lol
    }
}