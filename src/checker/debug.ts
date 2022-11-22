import { Op, ErrorCode } from './instructions'
import { debug } from './core'
import { Vector, vm } from './utils'
export function printBin(bin: Vector) {
    parseBin(bin, true)
}
interface DebugBinResult {
    operations: string[]
    storages: Uint8Array[]
    subroutines: PrintSubroutine[]
    sourceMap: DebugSourceMapEntry[]
    activeSubroutine: PrintSubroutine | undefined
}
interface PrintSubroutine {
    name: string
    address: number
    operations: PrintSubroutineOp[]
}
interface DebugSourceMapEntry {
    op: Op;
    bytecodePos: number;
    sourcePos: number;
    sourceEnd: number
}
interface PrintSubroutineOp {
    text: string
    address: number
}
function parseBin(bin: Vector, print = false): DebugBinResult {
    const end = bin.length
    let storageEnd = 0
    let newSubroutine = false
    let firstJump = false
    let newLine = false
    const result: DebugBinResult = {
        operations: [],
        storages: [],
        subroutines: [],
        sourceMap: [],
        activeSubroutine: undefined
    }
    for (let i = 0; i < end; i++) {
      if (storageEnd) {
        while (i < storageEnd) {
          const size = vm.readUint16(bin, i + 8);
          const data = bin.a.slice(i + 8 + 2, i + 8 + 2 + size);
          if (print) console.log(`(Storage (${size})"${data}")`);
          result.storages.push(data);
          i += 8 + 2 + size;
        }
        debug("");
        storageEnd = 0;
      }
      if (newSubroutine) {
        // const j = result.subroutines.findIndex(value => value.address === i)
        // if (j === -1) {
        //     if (print) console.log(`\nunknown!(): "`)
        // }
        // else {
        //     if (print) console.log(`\n&${j} ${r.name}(): "`)
        //     result.activeSubroutine = r
        // }
        let found = false;
        let j = 0;
        for (const r of result.subroutines) {
          if (r.address === i) {
            if (print) console.log(`\n&${j} ${r.name}(): "`);
            result.activeSubroutine = r;
            found = true;
            break;
          }
          j++;
        }
        if (!found) if (print) console.log(`\nunknown!(): "`);
        newSubroutine = false;
      }
      let params = "";
      let startI = i;
      let op = bin.a.at(i);
      switch (op) {
        case Op.TailCall:
        case Op.Call:
          params += ` &${vm.readUint32(bin, i + 1)}, ${vm.readUint16(
            bin,
            i + 5
          )}`;
          i = vm.eatParams(op, i);
          break;
        case Op.SourceMap:
          let size = vm.readUint32(bin, i + 1);
          let start = i + 1;
          i += 4 + size;
          params += ` ${start}->${i} (${size / (4 * 3)})`;
          for (let j = start + 4; j < i; j += 4 * 3) {
            const entry = {
              op: bin.a.at(vm.readUint32(bin, j)) as Op,
              bytecodePos: vm.readUint32(bin, j),
              sourcePos: vm.readUint32(bin, j + 4),
              sourceEnd: vm.readUint32(bin, j + 4 + 4),
            };
            result.sourceMap.push(entry);
            if (print)
              debug(
                `Map [${entry.bytecodePos}]${entry.op} to ${entry.sourcePos}:${entry.sourceEnd}`
              );
          }
          break;
        case Op.Subroutine: {
          const nameAddress = vm.readUint32(bin, i + 1);
          const address = vm.readUint32(bin, i + 5);
          const name = nameAddress ? vm.readStorage(bin, nameAddress + 8) : "";
          params += ` ${name}[${address}]`;
          i = vm.eatParams(op, i);
          result.subroutines.push({ name, address, operations: [] }); // TODO: Maybe operations hsould be undefined
          break;
        }
        case Op.Jump: {
          const address = vm.readUint32(bin, i + 1);
          params += ` [${startI + address}, +${address}]`;
          i = vm.eatParams(op, i);
          if (!firstJump) storageEnd = address;
          if (firstJump) newLine = true;
          firstJump = true;
          break;
        }
        case Op.Main:
        case Op.Return:
          newSubroutine = true;
          break;
        case Op.Distribute:
          params += ` &${vm.readUint16(bin, i + 1)} [${
            startI + vm.readUint32(bin, i + 3)
          }, +${vm.readUint32(bin, i + 3)}]`;
          i = vm.eatParams(op, i);
          newLine = true;
          break;
        case Op.JumpCondition:
          params += ` [${startI + vm.readUint32(bin, i + 1)}]`;
          i = vm.eatParams(op, i);
          newLine = true;
          break;
        case Op.CheckBody:
        case Op.InferBody:
        case Op.SelfCheck:
        case Op.Inline:
        case Op.Set:
        case Op.TypeArgumentDefault:
        case Op.ClassRef:
        case Op.FunctionRef:
          params += ` &${vm.readUint32(bin, i + 1)}`;
          i = vm.eatParams(op, i);
          break;
        case Op.New:
        case Op.Instantiate:
        case Op.CallExpression:
        case Op.Method:
        case Op.Function:
        case Op.Union:
        case Op.Tuple:
        case Op.TemplateLiteral:
        case Op.Class:
        case Op.ObjectLiteral:
        case Op.Slots:
          params += ` ${vm.readUint32(bin, i + 1)}`;
          i = vm.eatParams(op, i);
          break;
        case Op.Error:
          // TODO: format this as an error enum (instructions.ErrorCode[x])
          params += ` ${ErrorCode[vm.readUint32(bin, i + 1)]}`;
          i = vm.eatParams(op, i);
          break;
        case Op.Loads:
          params += ` ${vm.readUint16(bin, i + 1)} ${vm.readUint16(
            bin,
            i + 3
          )}`;
          i = vm.eatParams(op, i);
          break;
        case Op.Parameter:
        case Op.NumberLiteral:
        case Op.BigIntLiteral:
        case Op.StringLiteral:
          const address = vm.readUint32(bin, i + 1);
          params += ` "${vm.readStorage(bin, address + 8)}"`;
          i = vm.eatParams(op, i);
          break;
      }
      let text
      if (params) {
        text = `${op}${params}`
      } else {
        text = `${op}`
      }
      if (result.activeSubroutine) {
        result.activeSubroutine.operations.push({ text, address: startI });
      } else {
        result.operations.push(text);
      }
      if (print) {
        console.log(`[${startI}](${text})`);
        if (newLine) console.log("\n");
        newLine = false;
      }
    }
    if (print) console.log('\n')
    return result
}