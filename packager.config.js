/** @type {import('@electron/packager').Options} */
module.exports = {
  dir: '.',
  name: 'Interview Assistant',
  platform: 'win32',
  arch: 'x64',
  out: 'dist',
  overwrite: true,
  asar: true,
  prune: true,
  // Exclude everything except out/ and package.json
  ignore: [
    /[\\/](src|resources|dist|\.git|\.claude|node_modules)[\\/]/,
    /[\\/](postcss\.config|tailwind\.config|electron\.vite\.config|tsconfig)/,
    /\.map$/,
    /packager\.config\.js$/
  ]
}
