const { execFileSync } = require('child_process')
const path = require('path')

/**
 * afterPack：对 macOS 产物做一次 bundle 级 ad-hoc 重签。
 *
 * 背景：本机没有 Developer ID 证书时，electron-builder 会直接跳过签名
 * （日志：skipped macOS application code signing）。此时 .app 里只有
 * Electron 主程序自带的 linker-signed adhoc 最小签名，Contents/_CodeSignature
 * 整个缺失，codesign --verify 报「code has no resources but signature
 * indicates they must be present」。
 *
 * 后果：使用者用浏览器下载 dmg（会带上 com.apple.quarantine）后，
 * Gatekeeper 判定应用「已损坏，无法打开」，且右键打不开，是死路。
 *
 * 处理：补一次 ad-hoc 签名，生成 CodeResources 封印并让 Identifier 变成
 * appId。校验通过后失败模式降级为常见的「身份不明开发者」，
 * 用户仍可在 系统设置 → 隐私与安全性 里点「仍要打开」放行。
 * 彻底解决需要 Developer ID 签名 + 公证（notarytool），本钩子不涉及。
 */
exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit'
  })
}
