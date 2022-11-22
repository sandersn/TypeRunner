import * as ts from "typescript"
import process = require('process')
import fs = require('fs')
import { Compiler } from "./checker/compiler"
import { printBin } from './checker/debug'
const tree = ts.createSourceFile("foo.ts", fs.readFileSync(process.argv[2], 'utf8'), ts.ScriptTarget.ES2015)
const compiler = new Compiler()
const program = compiler.compileSourceFile(tree)
const bin = program.build()
printBin(bin)