// Integration test entry (runs inside the VS Code extension host).
import * as path from 'path'
import * as fs from 'fs'
import { createRequire } from 'module'

const require = createRequire(__filename)
const Mocha: any = require('mocha')

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 120_000 })
  const suiteDir = path.resolve(__dirname)
  for (const f of fs.readdirSync(suiteDir)) {
    if (f.endsWith('.spec.js')) mocha.addFile(path.join(suiteDir, f))
  }
  try {
    await new Promise<void>((resolve, reject) => {
      mocha.run((failures) => (failures === 0 ? resolve() : reject(new Error(`${failures} tests failed`))))
    })
  } catch (e) {
    console.error(e)
    throw e
  }
}
