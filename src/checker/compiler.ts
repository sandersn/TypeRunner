import { isFunctionDeclaration, isFunctionTypeNode, isMethodDeclaration, Node, NodeArray, SourceFile, SyntaxKind } from "typescript"
import { debug } from "./core"
import { ErrorCode, Op } from "./instructions"
import { vm, Vector } from './utils'

export enum SymbolType {
  Variable, //const x = true;
  Function, //function x() {}
  Class, //class X {}
  Inline, //subroutines of type argument defaults
  Type, //type alias, e.g. `foo` in `type foo = string;`
  TypeArgument, //template variable, e.g. T in function <T>foo(bar: T);
  TypeVariable, //type variables in distributive conditional types, mapped types, reserve a stack entry
}
class SourceMapEntry {
    constructor( public bytecodePos: number, public sourcePos: number, public sourceEnd: number) {}
}
class SourceMap {
    map: SourceMapEntry[] = []
    push(bytecodePos: number, sourcePos: number, sourceEnd: number) {
        this.map.push({ bytecodePos, sourcePos, sourceEnd })
    }
}
class ArgumentUsage {
    lastIp = 0
    lastSubroutineIndex = 0
    constructor(public argumentIndex = 0) {}
}
class TypeArgumentUsage {
    constructor (public symbolIndex: number, public ip: number) {}
}
class Symbol {
    name = ""
    active = true
    type = SymbolType.Type
    index = 0
    pos = 0
    end = 0
    declarations = 1
    routine: Subroutine | undefined = undefined
}
class FoundSymbol {
    constructor(public symbol: Symbol | undefined = undefined, public offset = 0) {}
}
class Section {
    end = 0
    lastOp = Op.Noop
    ops = 0
    isBlockTailCall = false
    hasChild = false
    typeArgumentUsages: TypeArgumentUsage[] = []
    next = -1
    constructor(public start = 0, public up = -1) {}
    registerTypeArgumentUsage(symbol: Symbol, ip: number) {
        for (const usage of this.typeArgumentUsages) {
            if (usage.symbolIndex === symbol.index) {
                usage.ip = ip
                return
            }
        }
        this.typeArgumentUsages.push(new TypeArgumentUsage(symbol.index, ip))
    }
}
class Subroutine {
  ops = new Vector() 
  lastOpIp = 0;
  sourceMap = new SourceMap();
  index = 0;
  slots = 0;
  slotIP = 0;
  nameAddress = 0;
  type = SymbolType.Type;
  symbols: Symbol[] = [];
  sections: Section[] = [];
  activeSection = 0;
  registerTypeArgumentUsage(symbol: Symbol) {
    this.sections[this.activeSection].registerTypeArgumentUsage(
      symbol,
      this.ip()
    );
  }
  constructor(public identifier = "") {
    this.sections.push(new Section(this.ip()));
  }
  isIgnoreNextSectionOP = false;
  ignoreNextSectionOP() {
    this.isIgnoreNextSectionOP = true;
  }
  blockTailCall() {
    this.sections[this.activeSection].isBlockTailCall = true;
  }
  pushOp(op: Op) {
    this.lastOpIp = this.ops.length;
    this.ops.push(op);
    if (!this.isIgnoreNextSectionOP) {
      this.sections[this.activeSection].lastOp = op;
      this.sections[this.activeSection].ops++;
    }
    this.isIgnoreNextSectionOP = false;
  }
  ip() {
    return this.ops.length;
  }
  pushSection() {
    const section = new Section(this.ip(), this.activeSection);
    this.sections.push(section);
    this.activeSection = this.sections.length - 1;
  }
  end() {
    this.sections[this.activeSection].end = this.ip();
  }
  popSection() {
    this.sections[this.sections.length - 1].end = this.ip();
    this.activeSection = this.sections[this.sections.length - 1].up;
    if (this.sections[this.activeSection].next === -1) {
      const next = new Section(this.ip());
      this.sections.push(next);
      next.up = this.sections[this.activeSection].up;
      this.activeSection = this.sections.length - 1;
    }
  }
  ended(section: Section): boolean {
    return section.next >= 0
      ? this.ended(this.sections[section.next])
      : section.ops === 0;
  }
  optimise() {
    //find all tail sections (sections that end the subroutine when executed)
    for (const section of this.sections) {
      if (section.hasChild || section.isBlockTailCall) {
        continue;
      }
      if (section.next >= 0 && !this.ended(section)) {
        continue;
      }
      let current = section.up >= 0 ? this.sections[section.up] : undefined;
      let tail = true;
      while (current) {
        if (current.isBlockTailCall) {
          tail = false;
          break;
        }
        //go upwards and check if some parent has ->next, if so, it is not a tail section
        if (!this.ended(current)) {
          tail = false;
          break;
        }
        if (current.up >= 0) {
          current = this.sections[current.up];
        } else {
          break;
        }
        if (tail) {
          //this section is a tail section, which means it returns the subroutine
          if (section.lastOp === Op.Call) {
            this.ops.a[section.end - 1 - 4 - 2] = Op.TailCall;
          }
          for (const usage of section.typeArgumentUsages) {
            const op = this.ops.a[usage.ip];
            if (op === Op.Rest) {
              this.ops.a[usage.ip] = Op.RestReuse;
            }
          }
        }
      }
    }
  }
  pushSourceMap(sourcePos: number, sourceEnd: number) {
    this.sourceMap.push(this.ops.length, sourcePos, sourceEnd);
  }
  getFlags() {
    const flags = 0;
    return flags;
  }
}
class StorageItem {
    address = 0
    constructor(public value: string) {}
}
class FrameOffset {
    frame = 0 //how many frames up
    symbol = 0 //the index of the symbol in referenced frame, refers directly to x stack entry of that stack frame.
}
class Visit {
    active = true
    ip = 0
    frameDepth = 0
    op = Op.Noop
    constructor(public index: number) {}
}
function visitOps2(subroutines: Subroutine[], visit: Visit, callback: (v: Visit) => void) {
    const ops = subroutines[visit.index].ops
    for (let i = 0; visit.active && i < ops.length; i++) {
        visit.op = ops.a[i];
        switch (visit.op) {
          case Op.Tuple:
          case Op.Union:
          case Op.Intersection:
          case Op.Class:
          case Op.ObjectLiteral:
          case Op.Return:
            visit.frameDepth--;
          case Op.JumpCondition:
            const leftProgram = vm.readUint16(ops, i + 1);
            const rightProgram = vm.readUint16(ops, i + 3);
            visit.frameDepth++;
            visit.index = leftProgram;
            visitOps2(subroutines, visit, callback);
            visit.index = rightProgram;
            visitOps2(subroutines, visit, callback);
            visit.frameDepth--;
            break;
          default:
            visit.ip = i;
            callback(visit);
            break;
        }
        i = vm.eatParams(visit.op, i)
    }
}
function visitOps(subroutines: Subroutine[], index: number, callback: (visit: Visit) => void) {
    visitOps2(subroutines, new Visit(index), callback)
}
class Program {
  storage: string[] = [];
  storageMap: Map<number, StorageItem> = new Map();
  storageIndex = 0;
  activeSubroutines: Subroutine[] = [];
  subroutines: Subroutine[] = [];
  constructor() {
    this.pushSubroutineNameLess(); // main (ed: lol, this is actually a closure then?)
  }
  pushSubroutineNameLess(): number {
    const routine = new Subroutine();
    routine.type = SymbolType.Inline;
    routine.index = this.subroutines.length;
    this.subroutines.push(routine);
    this.activeSubroutines.push(routine);
    return routine.index;
  }
  registerTypeArgumentUsage(symbol: Symbol) {
    if (this.activeSubroutines.length === 0) return;
    this.subBack().registerTypeArgumentUsage(symbol);
  }
  pushSubroutine(symbol: Symbol) {
    // find subroutine
    if (!symbol.routine) {
      throw new Error(`No routine for symbol ${symbol.name}`);
    }
    this.activeSubroutines.push(symbol.routine);
    return symbol.routine.index;
  }
  popSubroutine() {
    const subroutine = this.activeSubroutines.pop();
    if (!subroutine) {
      throw new Error(`No active subroutine found`);
    }
    if (!subroutine.ops.length) {
      throw new Error("Routine is empty");
    }
    subroutine.end();
    subroutine.optimise();
    subroutine.ops.push(Op.Return);
    return subroutine;
  }
  currentSubroutine() {
    return this.activeSubroutines[this.activeSubroutines.length - 1];
  }
  findSymbol(identifier: string): FoundSymbol {
    let offset = 0;
    for (let i = this.activeSubroutines.length - 1; i >= 0; i--) {
      const symbols = this.activeSubroutines[i].symbols;
      // we go in reverse to fetch the closest
      for (let j = symbols.length - 1; j >= 0; j--) {
        if (symbols[j].active && symbols[j].name === identifier) {
          return new FoundSymbol(symbols[j], offset);
        }
      }
    }
    return new FoundSymbol();
  }
  /**
   * The address is always written using 4 bytes.
   *
   * It sometimes is defined in Program as index to the storage or subroutine and thus is a immediate representation of the address.
   * In this case it will be replaced in build with the real address in the binary (hence why we need 4 bytes, so space stays constant).
   */
  pushAddress(address: number, offset = 0) {
    const ops = this.subBack().ops;
    vm.writeUint32(ops, offset === 0 ? ops.length : offset, address);
  }
  pushInt32Address(v: number, offset = 0) {
    const ops = this.subBack().ops;
    vm.writeUint32(ops, offset === 0 ? ops.length : offset, v);
  }
  pushUint32(v: number) {
    const ops = this.subBack().ops;
    vm.writeUint32(ops, ops.length, v);
  }
  pushUint16(v: number, offset = 0) {
    const ops = this.subBack().ops;
    vm.writeUint16(ops, offset === 0 ? ops.length : offset, v);
  }
  mainSubroutine() {
    return this.subroutines[0];
  }
  subBack() {
    return this.activeSubroutines[this.activeSubroutines.length - 1];
  }
  pushError(code: ErrorCode, node: Node) {
    const main = this.mainSubroutine();
    // errors need to be part of main
    main.sourceMap.push(0, node.pos, node.end);
    main.ops.push(Op.Error);
    main.ops.push(code as number);
  }
  pushSymbolAddress(foundSymbol: FoundSymbol) {
    if (!foundSymbol.symbol) {
      throw new Error("FoundSymbol without symbol");
    }
    this.pushUint16(foundSymbol.offset);
    this.pushUint16(foundSymbol.symbol.index);
  }
  pushSourceMap(node: Node) {
    this.subBack().pushSourceMap(node.pos, node.end);
  }
  ignoreNextSectionOP() {
    this.subBack().ignoreNextSectionOP();
  }
  pushSection() {
    this.subBack().pushSection();
  }
  blockTailCall() {
    this.subBack().blockTailCall();
  }
  popSection() {
    this.subBack().popSection();
  }
  //if > 0 expression statements keep the return value on the stack, otherwise they are removed.
  // e.g. `doIt()` removes its return type of `doIt()` while `doIt().deep()` keeps it (so that deep can be resolved).
  expressionResult = 0;
  pushKeepExpressionResult() {
    this.expressionResult++;
  }
  popKeepExpressionResult() {
    this.expressionResult--;
  }
  pushSlots() {
    this.currentSubroutine().slotIP = this.ip();
    this.pushOp(Op.Slots);
    this.pushUint16(0); // will be changed in program build
  }
  pushOp(op: Op, node?: Node) {
    if (node) this.pushSourceMap(node);
    this.subBack().pushOp(op);
  }
  subroutineIndex() {
    return this.subBack().index;
  }
  lastOpIp() {
    return this.subBack().lastOpIp;
  }
  ip() {
    return this.subBack().ops.length;
  }
  createSymbolCheckout() {
    return this.currentSubroutine().symbols.length;
  }
  restoreSymbolCheckout(checkpoint: number) {
    const symbols = this.currentSubroutine().symbols;
    for (; checkpoint < symbols.length; checkpoint++) {
      symbols[checkpoint].active = false;
    }
  }
  /**
   * A symbol could be type alias, function expression, var type declaration.
   * Each represents a type expression and gets its own subroutine. The subroutine
   * is directly created and an index assign. Later when pushSubroutine() is called,
   * this subroutine is returned and with OPs populated.
   *
   * Symbols will be created first before a body is extracted. This makes sure all
   * symbols are known before their reference is used.
   */
  pushSymbol(name: string, type: SymbolType, node: Node) {
    const subroutine = this.currentSubroutine();
    for (const v of subroutine.symbols) {
      if (type !== SymbolType.TypeVariable && v.name === name) {
        v.declarations++;
        return v;
      }
    }
    const symbol = new Symbol();
    symbol.name = name;
    symbol.type = type;
    symbol.index = this.currentSubroutine().symbols.length;
    symbol.pos = node.pos;
    symbol.end = node.end;
    if (type === SymbolType.TypeVariable) {
      subroutine.slots++;
    }
    subroutine.symbols.push(symbol);
    return subroutine.symbols[subroutine.symbols.length - 1];
  }
  pushSymbolForRoutine(name: string, type: SymbolType, node: Node) {
    const symbol = this.pushSymbol(name, type, node);
    if (symbol.routine) return symbol;
    const routine = new Subroutine(name);
    routine.type = type;
    routine.index = this.subroutines.length;
    routine.nameAddress = this.registerStorage(routine.identifier);
    this.subroutines.push(routine);
    symbol.routine = routine;
    return symbol;
  }
  //note: make sure the same name is not added twice. needs hashmap
  registerStorage(s: string) {
    if (!this.storageIndex) this.storageIndex = 1 + 4; // jump+address
    const address = this.storageIndex;
    this.storage.push(s);
    this.storageIndex += 8 + 2 + s.length; // hash + size + data
    return address;
  }
  /**
   * Pushes a Uint32 and stores the text into the storage.
   * @param s
   */
  pushStorage(s: string) {
    this.pushAddress(this.registerStorage(s));
  }
  pushStringLiteral(s: string, node: Node) {
    this.pushOp(Op.StringLiteral, node);
    this.pushStorage(s);
  }
  build(): Vector {
    let bin = new Vector()
    let address = 5; //we add JUMP + index when building the program to jump over all subroutines&storages
    bin.push(Op.Jump);
    vm.writeUint32(bin, bin.length, 0);
    for (const item of this.storage) {
      address += 8 + 2 + item.length; // hash + size + data
    }
    //set initial jump position to right after the storage data
    vm.writeUint32(bin, 1, address);
    // push all storage data to the binary
    for (const item of this.storage) {
      vm.writeUint64(bin, bin.length, vm.runtimeHash(item));
      vm.writeUint16(bin, bin.length, item.length);
      for (let i = 0; i < item.length; i++) {
        bin.push(item.charCodeAt(i));
      }
    }
    let sourceMapSize = 0;
    for (const routine of this.subroutines) {
      sourceMapSize += routine.sourceMap.map.length * 4 * 3;
    }
    bin.push(Op.SourceMap);
    vm.writeUint32(bin, bin.length, sourceMapSize);
    address += 1 + 4 + sourceMapSize; // Op.SourceMap + uint32 size

    let bytecodePosOffset = address;
    bytecodePosOffset += this.subroutines.length * (1 + 4 + 4 + 1); //OP::Subroutine + uint32 name address + uint32 routine address + flags
    bytecodePosOffset += 1; // Op.Main

    for (const routine of this.subroutines) {
      for (const map of routine.sourceMap.map) {
        vm.writeUint32(bin, bin.length, bytecodePosOffset + map.bytecodePos);
        vm.writeUint32(bin, bin.length, map.sourcePos);
        vm.writeUint32(bin, bin.length, map.sourceEnd);
      }
      bytecodePosOffset += routine.ops.length;
    }

    address += 1; // Op.Main
    address += this.subroutines.length * (1 + 4 + 4 + 1); //OP::Subroutine + uint32 name address + uint32 routine address + flags
    //after the storage data follows the subroutine meta-data.
    for (const routine of this.subroutines) {
      bin.push(Op.Subroutine);
      vm.writeUint32(bin, bin.length, routine.nameAddress);
      vm.writeUint32(bin, bin.length, address);
      bin.push(routine.getFlags());
      address += routine.ops.length;
    }
    //after subroutine meta-data follows the actual subroutine code, which we jump over.
    //this marks the end of the header.
    bin.push(Op.Main)
    for (const routine of this.subroutines) {
        if (routine.slots) {
            vm.writeUint16(routine.ops, routine.slotIP + 1, routine.slots);
        }
        bin.append(routine.ops);
    }
    // Note: Original converted bin to string for some reason
    return bin
  }
}
export class Compiler {
  compileSourceFile(file: SourceFile): Program {
    const program = new Program()
    this.handle(file, program)
    program.popSubroutine()
    return program
  }
  pushName(name: Node, program: Program) {
    if (!name) {
        program.pushOp(Op.Never)
        return
    }
    if (name.kind === SyntaxKind.Identifier) {
        program.pushStringLiteral((name as any).escapedText, name)
    }
    else {
        this.handle(name, program)
    }
  }
  pushFunction(op: Op, node: Node, program: Program, withName: Node) {
    let body: Node | undefined
    let type: Node | undefined
    let typeParameters: NodeArray<Node> | undefined
    let parameters: NodeArray<Node> | undefined
    if (isFunctionDeclaration(node)) {
        body = node.body
        type = node.type
        parameters = node.parameters
        typeParameters = node.typeParameters
    } else if (isFunctionTypeNode(node)) {
        type = node.type
        parameters = node.parameters
        typeParameters = node.typeParameters
    } else if (isMethodDeclaration(node)) {
        body = node.body
        type = node.type
        parameters = node.parameters
        typeParameters = node.typeParameters
    } else {
        throw new Error("function type not supported")
    }
    const pushBodyType = () => {
        let bodyAddress = 0
        if (body) {
            bodyAddress = program.pushSubroutineNameLess()
            program.pushOp(Op.TypeArgument)
            this.handle(body, program)
            program.pushOp(Op.Loads)
            program.pushUint16(0)
            program.pushUint16(0)
            program.pushOp(Op.UnwrapInferBody)
            program.popSubroutine()
        }
        if (type) {
            this.handle(type, program)
            if (bodyAddress) {
                program.pushOp(Op.CheckBody)
                program.pushAddress(bodyAddress)
            }
        } else {
            if (bodyAddress) {
                // no type given, so we infer from body
                program.pushOp(Op.InferBody)
                program.pushAddress(bodyAddress)
            } else {
                program.pushOp(Op.Unknown)
            }
        }
    }
    if (typeParameters) {
      //when there are type parameters, FunctionDeclaration returns a FunctionRef
      //which indicates the VM that the function needs to be instantiated first.
      const subroutineIndex = program.pushSubroutineNameLess()
      const size = 1 + parameters.length
      for (const param of typeParameters) {
        this.handle(param, program)
      }
      program.pushSlots()
      pushBodyType()
      for(const param of parameters) {
        this.handle(param, program)
      }
      this.pushName(withName, program)
      program.pushOp(op, node)
      program.pushUint16(size)
      program.popSubroutine()
      program.pushOp(Op.FunctionRef, node)
      program.pushAddress(subroutineIndex)
    } else {
        const size = 1 + parameters.length
        pushBodyType()
        for (const param of parameters) {
            this.handle(param, program)
        }
        this.pushName(withName, program)
        program.pushOp(op, node)
        program.pushUint16(size)
    }
  }
  handle(node: Node, program: Program): void {
    switch (node.kind) {
      case SyntaxKind.SourceFile:
        for (const statement of (node as SourceFile).statements) {
          this.handle(statement, program);
        }
        break;
      case SyntaxKind.AnyKeyword:
        program.pushOp(Op.Any, node);
        break;
      case SyntaxKind.NullKeyword:
        program.pushOp(Op.Null, node);
        break;
      case SyntaxKind.UndefinedKeyword:
        program.pushOp(Op.Undefined, node);
        break;
      case SyntaxKind.NeverKeyword:
        program.pushOp(Op.Never, node);
        break;
      case SyntaxKind.BooleanKeyword:
        program.pushOp(Op.Boolean, node);
        break;
        // many more like this, very boring
      default:
        debug(`Node ${node.kind} not handled`);
    }
  }
}
