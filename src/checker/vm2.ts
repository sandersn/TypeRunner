import { ErrorCode, Op } from './instructions'
import { Type, TypeKind, TypeRef, TypeFlag } from './types2'
import { parseHeader, Module, ModuleSubroutine, DiagnosticMessage } from './module2'
import { vm } from './utils'
import { const_hash } from '../hash'
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
  createLoop(var1: number, type: TypeRef): LoopHelper {
    const newLoop = loops.push()
    newLoop.set(var1, type)
    newLoop.ip = this.ip
    newLoop.startSP = sp
    newLoop.previous = this.loop
    return this.loop = newLoop
  }
  createEmptyLoop(): LoopHelper {
    const newLoop = loops.push()
    newLoop.ip = this.ip
    newLoop.startSP = sp
    newLoop.previous = this.loop
    return this.loop = newLoop
  }
  popLoop(): void {
    this.loop = this.loop!.previous
    loops.pop()
  }
  size(): number {
    return sp - this.initialSp;
  }
  op(): Op {
    return this.module.bin.a[this.ip];
  }
  pop(size: number): Type[] {
    sp -= size
    // just made up sp/size
    return stack.slice(sp, size)
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
  // ZoneScoped
  const bin = subroutine!.module.bin;
  while (true) {
    // ZoneScoped
    const ip = subroutine?.ip;
    const op: Op = bin[subroutine!.ip];
    switch (op) {
      case Op.Halt:
        return;
      case Op.Error: {
        const ip = subroutine?.ip;
        const code = subroutine?.parseUint16();
        switch (code) {
          case ErrorCode.CannotFind: {
            report(
              new DiagnosticMessage(
                `Cannot find name ${subroutine?.module.findIdentifier(ip)}`,
                ip
              )
            );
            break;
          }
          default:
            report(new DiagnosticMessage(code?.toString(), ip));
        }
        break;
      }
      case Op.Pop: {
        const type = pop();
        gc(type);
        break;
      }
      case Op.Never:
        stack[sp++] = new Type(TypeKind.Never, const_hash("never"));
        break;
      case Op.Any:
        stack[sp++] = new Type(TypeKind.Any, const_hash("any"));
        break;
      case Op.Undefined:
        stack[sp++] = new Type(TypeKind.Undefined, const_hash("undefined"));
        break;
      case Op.Null:
        stack[sp++] = new Type(TypeKind.Null, const_hash("null"));
        break;
      case Op.Unknown:
        stack[sp++] = new Type(TypeKind.Unknown, const_hash("unknown"));
        break;
      case Op.Parameter:
        const address = subroutine!.parseUint32();
        const type = new Type(TypeKind.Parameter, 0);
        type.readStorage(bin, address);
        type.type = pop();
        stack[sp++] = type;
        break;
      case Op.Function:
        handleFunction(TypeKind.Function);
        break;
    }
  }
}
function pop(): Type {
  return stack[--sp];
}
function handleFunction(kind: TypeKind): Type {
    const size = subroutine!.parseUint16()
    const name = pop()
    const type = new Type(kind, name.hash)
    // first is the name
    type.type = useAsRef(name)
    const types = subroutine?.pop(size)
}
function clear(module: Module): void {

}
function prepare(module: Module): void {
    parseHeader(module)
    subroutine = activeSubroutines.reset()
    subroutine.module = module
    // first is main
    subroutine.subroutine = module.subroutines[0]
    subroutine.ip = module.subroutines[0].address
    subroutine.initialSp = sp
    subroutine.depth = 0
}
function use(type: Type): Type {
    type.refCount++
    return type
}
function useAsRef(type: Type, next?: TypeRef): TypeRef {
    type.refCount++
    return new TypeRef(type, next)
}
function drop(_type: Type): void;
function drop(_types: TypeRef[]): void;
function drop(_types: Type | TypeRef[]): void {
    
}
function gcWithoutChildren(type: Type): void {
    // just for debugging
    if (type.flag & TypeFlag.Deleted) {
        throw new Error("Type already deleted")
    }
    type.flag |= TypeFlag.Deleted;
    // delete type;
}
function gc(_type?: Type): void {
}
function gcFlush(): void {
    
}
function gcStack(): void {
   sp = 0 
}
function gcStackAndFlush(): void {
}
function allocate(kind: TypeKind, hash = 0): Type {
    return new Type(kind, hash)
}
function allocateRefs(size: number): TypeRef[] {
    return new Array(size)
}
function addHashChild(type: Type, child: Type, size: number): void {
    const bucket = child.hash % size
    const entry = type.children[bucket]
    if (entry.type) {
        // hash collision, prepend to the list
        entry.next = useAsRef(child, entry.next)
    } else {
        entry.type = use(child)
    }
}
function addHashChildWithoutRefCounter(type: Type, child: Type, size: number) {
    const bucket = child.hash % size
    const entry = type.children[bucket]
    if (entry.type) {
        // hash collision, prepend to the list
        entry.next = new TypeRef(child, entry.next)
    } else {
        entry.type = child
    }
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
function report(message: DiagnosticMessage) {
    message.module = subroutine?.module
    message.module?.errors.push(message)
}
enum TypeWidenFlag {
    Any = 1<<1,
    String = 1<<2,
    Number = 1<<3,
    Boolean = 1<<4,
    BigInt = 1<<5,
};