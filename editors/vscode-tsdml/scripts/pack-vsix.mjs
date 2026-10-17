/**
 * Pack (and optionally install) the extension as a `.vsix`.
 *
 * `vsce` is not usable here: this machine's npm registry certificate has
 * expired, so `npx @vscode/vsce` cannot be fetched. A VSIX is just a ZIP with a
 * `extension/` folder, `extension.vsixmanifest` and `[Content_Types].xml`, so
 * this writes one directly (minimal ZIP writer, no dependency).
 *
 * Why this is not "npm run pack" only: a *running* VS Code maps the extension's
 * native `@tsdml/compiler` binary, so it cannot be overwritten in place. VS Code
 * installs each version into its own folder, so `--install` packs a *higher*
 * version (`patch+1-dev.<timestamp>`) and installs that: the new compiler lands
 * in a fresh directory and takes effect on the next window reload.
 *
 * Usage:
 *   node scripts/pack-vsix.mjs                 # build a .vsix next to package.json
 *   node scripts/pack-vsix.mjs --install       # …and install it into VS Code
 *   node scripts/pack-vsix.mjs --version 9.9.9 # explicit version
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))

const args = process.argv.slice(2)
const install = args.includes('--install')
const explicit = args.includes('--version') ? args[args.indexOf('--version') + 1] : undefined

/** `0.0.5` → `0.0.6-dev.202610060815` (greater than any shipped release). */
function devVersion(base) {
  const [major, minor, patch] = base.split('.').map((n) => Number.parseInt(n, 10))
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12)
  return `${major}.${minor}.${patch + 1}-dev.${stamp}`
}

const version = explicit ?? (install ? devVersion(pkg.version) : pkg.version)

/** What the extension needs at runtime (mirrors .vscodeignore). */
const BUNDLES = ['client.js', 'server.js', 'patch-tsserver-tsdml.js']
const MODULES = ['node_modules/@tsdml', 'node_modules/tsdml-tsplugin', 'node_modules/@volar']

// --- staging ---------------------------------------------------------------
const stage = join(pkgRoot, '.vsix-stage')
rmSync(stage, { recursive: true, force: true })
mkdirSync(join(stage, 'dist'), { recursive: true })
for (const bundle of BUNDLES) {
  const from = join(pkgRoot, 'dist', bundle)
  if (!existsSync(from)) throw new Error(`missing build output ${from} — run scripts/build.mjs first`)
  cpSync(from, join(stage, 'dist', bundle))
}
cpSync(join(pkgRoot, 'syntaxes'), join(stage, 'syntaxes'), { recursive: true })
cpSync(join(pkgRoot, 'language-configuration.json'), join(stage, 'language-configuration.json'))
for (const mod of MODULES) {
  const from = join(pkgRoot, mod)
  if (!existsSync(from)) continue
  cpSync(from, join(stage, mod), { recursive: true })
}
writeFileSync(
  join(stage, 'package.json'),
  JSON.stringify({ ...pkg, version }, null, 2) + '\n',
)

// --- zip -------------------------------------------------------------------
const CRC = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()
const crc32 = (buf) => {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** Minimal ZIP writer: stored names, deflate data, no zip64. */
function zip(files) {
  const parts = []
  const central = []
  let offset = 0
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8')
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
    const deflated = deflateRawSync(raw)
    const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    parts.push(local, nameBuf, deflated)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(deflated.length, 20)
    cd.writeUInt32LE(raw.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, nameBuf)
    offset += local.length + nameBuf.length + deflated.length
  }
  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, centralBuf, end])
}

const walk = (dir, base = dir) => {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full, base))
    else out.push({ name: relative(base, full).split('\\').join('/'), data: readFileSync(full) })
  }
  return out
}

const manifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${pkg.name}" Version="${version}" Publisher="${pkg.publisher}" />
    <DisplayName>${pkg.displayName ?? pkg.name}</DisplayName>
    <Description xml:space="preserve">${pkg.description ?? ''}</Description>
    <Tags>tsdml</Tags>
    <Categories>Programming Languages</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${pkg.engines?.vscode ?? '^1.82.0'}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="${pkg.extensionDependencies?.join(',') ?? ''}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
`
const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/>
  <Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".node" ContentType="application/octet-stream"/>
</Types>
`

const files = [
  { name: 'extension.vsixmanifest', data: manifest },
  { name: '[Content_Types].xml', data: contentTypes },
  ...walk(stage).map((f) => ({ name: `extension/${f.name}`, data: f.data })),
]
const vsix = join(pkgRoot, `vscode-tsdml-${version}.vsix`)
writeFileSync(vsix, zip(files))
rmSync(stage, { recursive: true, force: true })

const binary = files.find((f) => f.name.endsWith('.node'))
console.log(`[vsix] ${vsix}`)
console.log(`[vsix] ${files.length} files, ${(statSync(vsix).size / 1024 / 1024).toFixed(2)} MiB, compiler ${binary ? binary.data.length : 'MISSING'} bytes`)

if (install) {
  const cli = process.env.VSCODE_CLI ?? (process.platform === 'win32' ? 'code.cmd' : 'code')
  console.log(`[vsix] installing via ${cli} …`)
  // Node cannot spawn a `.cmd` directly on Windows (EINVAL since the CVE-2024-27980
  // fix); going through the command interpreter is the documented workaround and
  // avoids `shell: true`'s argument-concatenation warning.
  const [cmd, args] =
    process.platform === 'win32'
      ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', cli, '--install-extension', vsix, '--force']]
      : [cli, ['--install-extension', vsix, '--force']]
  execFileSync(cmd, args, { stdio: 'inherit' })
  console.log('[vsix] installed — reload the VS Code window (Developer: Reload Window) to use it')
}
