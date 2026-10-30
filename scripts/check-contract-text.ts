import { readFileSync } from 'node:fs'

const contract = readFileSync(new URL('../CONTRACTS.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const providers = readFileSync(new URL('../src/providers.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const block = contract.split('## 16.')[1]?.split('```ts\n')[1]?.split('```')[0]
if (!block) throw new Error('CONTRACTS.md section 16 TypeScript block missing')
const expected = block.split('\n').map((line) => line.startsWith('  ') ? line.slice(2) : line).join('\n')
for (const name of ['LabourRow', 'LabourSupply']) {
  const declaration = new RegExp(`export interface ${name} \\{[^}]*\\}`)
  const spec = expected.match(declaration)?.[0]
  if (!spec || providers.match(declaration)?.[0] !== spec) {
    throw new Error(`${name} differs from CONTRACTS.md section 16`)
  }
}
console.log('LabourRow and LabourSupply match CONTRACTS.md section 16')
