import { packager } from '@electron/packager'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const ignore = [
  /[\\/](src|resources|\.git|\.claude)[\\/]/,
  /[\\/](postcss\.config|tailwind\.config|electron\.vite\.config|tsconfig)/,
  /[\\/]scripts[\\/]/,
  /\.map$/,
  /packager\.config\.js$/
]

console.log('Building...')
const result = await packager({
  dir: root,
  name: 'Interview Assistant',
  platform: 'win32',
  arch: 'x64',
  out: join(root, 'dist'),
  overwrite: true,
  asar: true,
  prune: true,
  ignore
})

const appDir = result[0]
console.log('Packaged to:', appDir)

// Zip the output directory using PowerShell (available on all modern Windows)
const zipPath = appDir + '.zip'
console.log('Creating zip:', zipPath)
try {
  await execAsync(
    `powershell -Command "Compress-Archive -Path '${appDir}\\*' -DestinationPath '${zipPath}' -Force"`
  )
  console.log('Done! Distribute:', zipPath)
} catch (e) {
  console.warn('Zip step failed (non-fatal):', e.message)
  console.log('Manually zip the folder:', appDir)
}
