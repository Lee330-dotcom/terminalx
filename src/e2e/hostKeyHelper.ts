import type { Page } from 'puppeteer-core'

/** 指纹确认弹窗上的「信任并继续」按钮文案（中/英）。 */
const TRUST_LABELS = ['信任并继续', 'Trust and Continue']

/** 指纹确认弹窗的标题文案（中/英），用于确认当前弹的就是指纹弹窗。 */
const TITLE_LABELS = ['确认主机身份', 'Confirm Host Identity']

/** 在页面里查找当前可见的指纹确认弹窗元素。 */
async function findDialog(page: Page): Promise<boolean> {
  return page.evaluate(
    (titles) => {
      const dialogs = Array.from(document.querySelectorAll('.host-key-dialog'))
      return dialogs.some((d) => {
        // el-dialog 关闭后仍留在 DOM 里，只是被隐藏，必须判可见性
        if (d.getClientRects().length === 0) return false
        const title = d.querySelector('.el-dialog__title')?.textContent?.trim() ?? ''
        return titles.some((t) => title.includes(t))
      })
    },
    TITLE_LABELS
  )
}

/** 等待指纹确认弹窗出现。 */
export async function waitHostKeyDialog(page: Page, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await findDialog(page)) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('timeout waiting for host key dialog')
}

/**
 * 等待指纹确认弹窗完全消失。
 *
 * 弹窗消失前遮罩仍在，会挡住终端点击与键盘输入，
 * 因此交互终端前必须先等它关掉。
 */
export async function waitNoHostKeyDialog(page: Page, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const visible = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.host-key-dialog')).some(
        (d) => d.getClientRects().length > 0
      )
    )
    if (!visible) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('host key dialog is still visible')
}

/**
 * 点击指纹确认弹窗上的「信任并继续」。
 * 返回是否找到了按钮（找不到时返回 false，不抛错）。
 */
export async function clickTrustHostKey(page: Page): Promise<boolean> {
  return page.evaluate((labels) => {
    const dialogs = Array.from(document.querySelectorAll('.host-key-dialog'))
    for (const dialog of dialogs) {
      const buttons = Array.from(dialog.querySelectorAll('button'))
      const btn = buttons.find((b) => labels.some((l) => (b.textContent ?? '').includes(l)))
      if (btn) {
        btn.click()
        return true
      }
    }
    return false
  }, TRUST_LABELS)
}

/**
 * 安装自动信任守望者：指纹确认弹窗一出现就自动点「信任并继续」。
 *
 * 用途：既有 e2e 用例只关心终端行为，握手被指纹确认挡住会假失败；
 * 这里在页面上下文里挂一个定时器，避免用例之间手工配合。
 * 需要专门验证指纹流程的用例不要安装它。
 *
 * 同时注册 evaluateOnNewDocument，这样页面 reload 之后守望者依然生效。
 */
export async function autoTrustHostKeys(page: Page): Promise<void> {
  const install = (labels: string[]): void => {
    const w = window as unknown as { __txHostKeyAutoTrust?: number }
    if (w.__txHostKeyAutoTrust) return
    w.__txHostKeyAutoTrust = window.setInterval(() => {
      const dialogs = Array.from(document.querySelectorAll('.host-key-dialog'))
      for (const dialog of dialogs) {
        if (dialog.getClientRects().length === 0) continue
        const buttons = Array.from(dialog.querySelectorAll('button'))
        const btn = buttons.find((b) => labels.some((l) => (b.textContent ?? '').includes(l)))
        if (btn) {
          btn.click()
          return
        }
      }
    }, 200)
  }
  await page.evaluateOnNewDocument(install, TRUST_LABELS)
  await page.evaluate(install, TRUST_LABELS)
}

/** 停止自动信任守望者。 */
export async function stopAutoTrustHostKeys(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __txHostKeyAutoTrust?: number }
    if (w.__txHostKeyAutoTrust) {
      window.clearInterval(w.__txHostKeyAutoTrust)
      w.__txHostKeyAutoTrust = undefined
    }
  })
}
