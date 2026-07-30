import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(projectRoot, 'native', 'fn-modifier-hotkeys.c')
const outputDirectory = join(projectRoot, '.native-build')
const outputPath = join(outputDirectory, 'helper-fn-modifier-hotkeys')
const architectures = ['arm64', 'x86_64']

async function runXcrun(args) {
  return execFileAsync('xcrun', args)
}

async function main() {
  if (process.platform !== 'darwin') {
    console.log('[native] Skipping Fn modifier hotkey helper build outside macOS')
    return
  }

  await mkdir(outputDirectory, { recursive: true })
  const temporaryDirectory = await mkdtemp(join(outputDirectory, '.hotkey-build-'))

  try {
    const architectureOutputs = []
    for (const architecture of architectures) {
      const architectureOutput = join(temporaryDirectory, `helper-${architecture}`)
      await runXcrun([
        '--sdk',
        'macosx',
        'clang',
        '-std=c11',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Wpedantic',
        '-Werror',
        '-arch',
        architecture,
        '-mmacosx-version-min=14.0',
        sourcePath,
        '-framework',
        'ApplicationServices',
        '-o',
        architectureOutput
      ])
      architectureOutputs.push(architectureOutput)
    }

    const universalOutput = join(temporaryDirectory, 'helper-universal')
    await runXcrun(['lipo', '-create', ...architectureOutputs, '-output', universalOutput])
    await chmod(universalOutput, 0o755)
    await execFileAsync(universalOutput, ['--self-test'])
    await runXcrun(['lipo', universalOutput, '-verify_arch', ...architectures])
    await rename(universalOutput, outputPath)

    console.log(`[native] Built and verified ${outputPath}`)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

await main()
