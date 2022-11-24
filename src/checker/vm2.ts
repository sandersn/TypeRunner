import { Op } from './instructions'
import { Type, TypeKind, TypeRef, TypeFlag } from './types2'
import { Module, ModuleSubroutine } from './module2'
import { vm } from './utils'
const poolSize = 10_000
let stack: Type[] = new Array(4069 * 10)
let sp = 0
class LoopHelper {
    current?: TypeRef
    previous?: LoopHelper
    ip = 0
    startSP = 0
    var1 = 0
    set(var1: number, typeref: TypeRef) {
        this.var1 = var1
        this.current = typeref
    }
    next() {
        if (!this.current) return false
        stack[this.var1] = this.current.type!
        this.current = this.current.next
        return true
    }
}
enum SubroutineFlag {
    InferBody = 1 << 0
}
export class ActiveSubroutine {
  module: Module;
  subroutine: ModuleSubroutine;
  ip = 0; // current instruction pointer
  depth = 0;
  initialSp = 0; // initial stack pointer
  //the amount of registered variable slots on the stack. will be subtracted when doing popFrame()
  //type arguments of type functions and variables like for mapped types
  variables = 0;
  variableIPs: number[] = [];
  typeArguments = 0;
  /** @see SubroutineFlag */
  flags = 0;
  loop?: LoopHelper;
  createLoop(var1: number, type: TypeRef): LoopHelper {}
  createEmptyLoop(): LoopHelper {}
  popLoop(): void {}
  size(): number {
    return sp - this.initialSp;
  }
  op(): Op {
    return this.module.bin.a[this.ip];
  }
  parseUint32() {
    const val = vm.readUint32(this.module.bin, this.ip + 1);
    this.ip += 4;
    return val;
  }
  isMain() {
    return this.subroutine.main;
  }
  parseInt32() {
    const val = vm.readInt32(this.module.bin, this.ip + 1);
    this.ip += 4;
    return val;
  }
  parseUint16() {
    const val = vm.readUint16(this.module.bin, this.ip + 1);
    this.ip += 2;
    return val;
  }
}
export class StackPool<T, Size extends number> {
  private values: T[] = [];
  i = 0;
  constructor(private size: Size) {
    this.values = new Array(size);
  }
  at(pos: number) {
    return this.values[pos];
  }
  front() {
    return this.values[this.i];
  }
  index() {
    return this.i;
  }
  length() {
    return this.i + 1;
  }
  reset() {
    this.i = 0;
    return this.values[0];
  }
  push() {
    if (this.i >= this.size) throw new Error("Stack overflow");
    return this.values[++this.i];
  }
  pop() {
    if (this.i === 0) throw new Error("Stack underflow");
    return this.values[--this.i];
  }
}
const stackSize = 1024
const activeSubroutines = new StackPool<ActiveSubroutine, typeof stackSize>(stackSize)
const loops = new StackPool<LoopHelper, typeof stackSize>(stackSize)
let stepper = false
let subroutine: ActiveSubroutine | undefined = undefined;
function process(): void {

}
function clear(module: Module): void {

}
function prepare(module: Module): void {

}
function drop(type: Type): void;
function drop(types: TypeRef[]): void;
function drop(types: Type | TypeRef[]): void {
    
}
function gc(type: Type): void;
function gc(types: TypeRef[]): void;
function gc(types: Type | TypeRef[]): void {
    
}
function gcFlush(): void {
    
}
function gcStack(): void {
    
}
function gcStackAndFlush(): void {
    
}
function allocate(kind: TypeKind, hash = 0): Type {

}
function allocateRefs(size: number): TypeRef[] {

}
function addHashChild(type: Type, child: Type, size: number): void {

}
function popFrame(): Type[] {

}
function run(module: Module): void {
    // missing pool-clearing here, since I don't think I'll need it
    sp = 0
    loops.reset()
    prepare(module)
    process()
}
function call(module: Module, index = 0, args = 0): void {

}
interface CStack {
    iterator: Type[]
    i: number
    round: number
}
export class CartesianProduct {
  stack: CStack[] = [];
  current(s: CStack): Type {
    return s.iterator[s.i];
  }
  next(s: CStack): boolean {
    return ++s.i === s.iterator.length ? ((s.i = 0), false) : true;
  }
  toGroup(type: Type): Type[] {
    switch (type.kind) {
      case TypeKind.Boolean:
        return [
          new Type(TypeKind.Literal, 0).setFlag(TypeFlag.True),
          new Type(TypeKind.Literal, 0).setFlag(TypeFlag.False),
        ];
      case TypeKind.Null:
        return [
          new Type(TypeKind.Literal, 0).setLiteral(
            TypeFlag.StringLiteral,
            "null"
          ),
        ];
      case TypeKind.Undefined:
        return [
          new Type(TypeKind.Literal, 0).setLiteral(
            TypeFlag.StringLiteral,
            "null"
          ),
        ];
      case TypeKind.Union:
        const result: Type[] = [];
        let current = type.type as TypeRef | undefined;
        while (current) {
          const g = this.toGroup(current.type!);
          for (const s of g) result.push(s);
          current = current.next;
        }
        return result;
      default:
        return [type];
    }
  }
  add(item: Type): void {
    this.stack.push({ iterator: this.toGroup(item), i: 0, round: 0 });
  }
  calculate(): Type[][] {
    let result: Type[][] = [];
    outer: while (true) {
        let row: Type[] = [];
        for (const s of this.stack) {
            const item = this.current(s);
            if (item.kind === TypeKind.TemplateLiteral) {
                let current = item.type as TypeRef | undefined;
                while (current) {
                    row.push(current.type!);
                    current = current.next;
                }
            } else {
                row.push(item);
            }
        }
        result.push(row);
        for (let i = stack.length - 1; i >= 0; i--) {
            if (this.next(this.stack[i])) continue outer;
            if (i === 0) break outer;

        }
        break;
    }
    return result
  }
}