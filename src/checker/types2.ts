import { vm, Vector } from './utils'
export enum TypeKind {
  Unknown,
  Never,
  Any,
  Null,
  Undefined,
  String,
  Number,
  BigInt,
  Boolean,
  Symbol,
  Literal,
  IndexSignature,
  Method,
  MethodSignature,
  Property,
  PropertySignature,
  Class,
  ClassRef,
  ClassInstance,
  ObjectLiteral,
  Union,
  Array,
  Rest,
  Tuple,
  TupleMember,
  TemplateLiteral,
  Parameter,
  Function,
  FunctionRef,
}
//Used in the vm
export enum TypeFlag {
    Readonly = 1<<0,
    Optional = 1<<1,
    StringLiteral = 1<<2,
    NumberLiteral = 1<<3,
    BooleanLiteral = 1<<4,
    BigIntLiteral = 1<<5,
    True = 1<<6,
    False = 1<<7,
    Stored = 1<<8, //Used somewhere as cache or as value (subroutine->result for example), and thus can not be stolen/modified
    RestReuse = 1<<9, //allow to reuse/steal T in ...T
    Deleted = 1<<10, //for debugging purposes
    Static = 1<<11,
};


export class TypeRef {
  constructor(public type?: Type, public next?: TypeRef) {}
}
export class Type {
  ip: number
  flag = 0
    refCount = 0
    text: string
    size = 0
    type: Type | TypeRef | string | undefined // depends on kind
    children: TypeRef[]
    constructor(public kind: TypeKind, public hash: number) {}
    isDeleted() { return this.flag & TypeFlag.Deleted }
    fromLiteral(literal: Type) {
        this.flag = literal.flag
        if (literal.type) {
            // dynamic value, so copy it
            this.setDynamicText(literal.text, literal.hash)
        } else {
            // TODO: Not sure that reuse is safe here, but probably
            this.text = literal.text
            this.hash = literal.hash
        }
    }
    singleChild() {
        return this.type && (this.type as TypeRef).next === undefined
    }
    child() {
        return this.type ? (this.type as TypeRef).type : undefined
    }
    appendLiteral(literal: Type) {
        this.appendText(literal.text)
    }
    appendText(value: string) {
        if (!this.type) {
            this.setDynamicText(value)
        } else {
            this.type += value
            this.text = this.type as string
            this.hash = vm.runtimeHash(this.text)
        }
    }
    setDynamicText(value: string, hash = 0) {
        this.type = value;
        this.text = this.type as string;
        this.hash = hash ? hash : vm.runtimeHash(this.text);
    }
    setDynamicLiteral(flag: TypeFlag, value: string) {
        this.flag |= flag;
        this.setDynamicText(value);
    }
    setFlag(flag: TypeFlag) {
        this.flag |= flag;
        return this; // :roll_eyes:
    }
    setLiteral(flag: TypeFlag, value: string) {
        this.flag |= flag;
        this.text = value;
        this.hash = vm.runtimeHash(this.text);
        return this;
    }
    appendChild(ref: TypeRef) {
        if (!this.type) {
            this.type = ref;
        } else {
            (this.type as TypeRef).next = ref;
        }
        this.size++;
    }
    readStorage(bin: Vector, offset: number) {
      //offset points to the start of the storage entry: its structure is: hash+size+data;
      this.hash = vm.readUint64(bin, offset);
      offset += 8
      this.text = vm.readStorage(bin, offset);
    }
}
export function findChild(type: Type, hash: number) {
    if (!type.children.length) {
        let current: TypeRef | undefined = type.type as TypeRef;
        while (current) {
            if (current.type!.hash === hash) return current.type
            current = current.next
        }
        return undefined;
    } else {
        let entry: TypeRef | undefined = type.children[hash % type.children.length];
        if (!entry.type) return undefined;
        while (entry && entry.type!.hash !== hash)
          // step through linked collisions
          entry = entry.next;
        return entry ? entry.type : undefined;
    }
}
export function forEachChild(type: Type, callback: (child: Type) => unknown) {
    if (type.type) {
        let stop = false
        let current: TypeRef | undefined = type.type as TypeRef
        while (!stop && current) {
            stop = !!callback(current.type!)
            current = current.next
        } 
    } else {
        let stop = false
        let i = 0
        let end = type.children.length
        while (!stop && i < end) {
            let child = type.children[i]
            // bucket could be empty
            if (child.type) {
                stop = !!callback(child.type)
            }
            if (child.next) {
                // has hash collision, execute them as well
                let current: TypeRef | undefined = child.next
                while (!stop && current) {
                    stop = !!callback(current.type!)
                    current = current.next
                }
            }
            i++
        }
    }
}
export function forEachHashTableChild(type: Type, callback: (child: Type, stop: boolean) => void) {
    let stop = false
    let i = 0
    let end = type.children.length
    while (!stop && i < end) {
        let child = type.children[i]
        // bucket could be empty
        if (child.type) {
            callback(child.type, stop)
        }
        if (child.next) {
            // has hash collision, execute them as well
            let current: TypeRef | undefined = child.next
            while (!stop && current) {
                callback(current.type!, stop)
                current = current.next
            }
        }
        i++
    }
}
export function getPropertyOrMethodName(type: Type) {
    return type.children[0].type
}
export function getPropertyOrMethodType(type: Type) {
    return type.children[1].type
}
export function stringify(type: Type): string {
  switch (type.kind) {
    case TypeKind.Boolean:
      return "boolean";
    case TypeKind.Number:
      return "number";
    case TypeKind.String:
      return "string";
    case TypeKind.Never:
      return "never";
    case TypeKind.Any:
      return "any";
    case TypeKind.Unknown:
      return "unknown";
    case TypeKind.PropertySignature:
      return `${stringify((type.type as TypeRef).type!)}: ${stringify(
        (type.type as TypeRef).next!.type!
      )}`;
    case TypeKind.ObjectLiteral: {
      let r = "{";
      let i = 0;
      forEachChild(type, (child) => {
        if (i++ > 20) {
          r += "...";
          return true;
        }
        r += stringify(child);
        r += ", ";
      });
      r += "}";
      return r;
    }
    case TypeKind.TupleMember: {
      // TODO: In the original, this only print on a top level call
      let r = "TupleMember:";
      if (type.text) {
        r += type.text;
        if (type.flag & TypeFlag.Optional) r += "?";
        r += ": ";
      }
      if (!type.type) {
        r += "UnknownTupleMember";
      } else {
        r += stringify(type.type as Type);
      }
      return r;
    }
    case TypeKind.Array:
      return `Array<${stringify(type.type as Type)}>`;
    case TypeKind.Rest:
      return `...${stringify(type.type as Type)}`;
    case TypeKind.Parameter:
      return `${type.text}: ${stringify(type.type as Type)}`;
    case TypeKind.Tuple: {
      let r = "[";
      let i = 0;
      let current = type.type as TypeRef | undefined;
      while (current) {
        if (i++ > 20) {
          r += "...";
          break;
        }
        r += stringify(current.type!);
        current = current.next;
        if (current) r += ", ";
      }
      r += "]";
      return r;
    }
    case TypeKind.Union: {
      let r = "";
      let i = 0;
      let current = type.type as TypeRef | undefined;
      while (current) {
        if (i++ > 20) {
          r += "...";
          break;
        }
        r += stringify(current.type!);
        current = current.next;
        if (current) r += " | ";
      }
      return r;
    }
    case TypeKind.TemplateLiteral: {
      let r = "`";
      let current = type.type as TypeRef | undefined;
      while (current) {
        if (current.type!.kind !== TypeKind.Literal) r += "${";
        if (current.type!.flag & TypeFlag.StringLiteral) {
          r += current.type!.text;
        } else {
          r += stringify(current.type!);
        }
        if (current.type!.kind !== TypeKind.Literal) r += "}";
        current = current.next;
      }
      r += "`";
      return r;
    }
    case TypeKind.Function: {
      let first = type.type as TypeRef;
      let nameType = first.type;
      let second = first.next as TypeRef;
      let returnType = second.type;
      let r = "(";
      let current = second.next as TypeRef | undefined;
      while (current) {
        r += stringify(current.type!);
        current = current.next;
        if (current) r += ", ";
      }
      return r + ") => (" + stringify(returnType!) + ")";
    }
    case TypeKind.Literal:
      if (type.flag & TypeFlag.StringLiteral) return '"' + type.text + '"';
      else if (type.flag & TypeFlag.NumberLiteral) return type.text;
      else if (type.flag & TypeFlag.True) return "true";
      else if (type.flag & TypeFlag.False) return "false";
      else return "UnknownLiteral";
    default:
      return "*notStringified*";
  }
}
export function isOptional(type: Type) {
    return type.flag & TypeFlag.Optional
}

