import { app, BrowserWindow, powerSaveBlocker } from 'electron'
import { Settings } from '@shared/types'

let sleepBlockerId: number | null = null

/** 应用与系统行为相关的设置（登录项、休眠阻止）。 */
export function applySystemSettings(s: Settings): void {
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: s.autoLaunch })
  }
  if (s.blockSystemSleep && sleepBlockerId === null) {
    sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension')
  } else if (!s.blockSystemSleep && sleepBlockerId !== null) {
    powerSaveBlocker.stop(sleepBlockerId)
    sleepBlockerId = null
  }
}

/** 应用窗口表现相关设置（不透明度、界面缩放）。 */
export function applyWindowUi(s: Settings): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.setOpacity(Math.max(0.3, s.windowOpacity / 100))
    win.webContents.setZoomFactor(s.uiScale / 100)
  }
}
