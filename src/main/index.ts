import { readFileSync } from 'fs'
import { app, shell, dialog, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { AppContext } from './appContext'
import { registerIpcHandlers } from './ipc'
import { applySystemSettings, applyWindowUi } from './uiSettings'

let ctx: AppContext
let quitting = false

// 禁用硬件加速必须在 app ready 之前生效
function applyEarlySettings(): void {
  try {
    const raw = JSON.parse(
      readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf8')
    ) as {
      disableHardwareAcceleration?: boolean
    }
    if (raw.disableHardwareAcceleration) app.disableHardwareAcceleration()
  } catch {
    /* 首次运行无配置文件 */
  }
}

applyEarlySettings()

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 关闭按钮行为：hide 时隐藏到 Dock 保留会话（仅 macOS 有意义）；
  // 行为为退出且开启「退出前确认」时先弹确认框
  mainWindow.on('close', (e) => {
    if (quitting || process.platform !== 'darwin') return
    try {
      const raw = JSON.parse(
        readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf8')
      ) as { closeButtonAction?: string; confirmOnClose?: boolean }
      if (raw.closeButtonAction === 'hide') {
        e.preventDefault()
        mainWindow.hide()
        return
      }
      if (raw.confirmOnClose) {
        e.preventDefault()
        void dialog
          .showMessageBox(mainWindow, {
            type: 'question',
            buttons: ['退出', '取消'],
            defaultId: 1,
            cancelId: 1,
            message: '确定退出 terminalX？'
          })
          .then((r) => {
            if (r.response === 0) {
              quitting = true
              mainWindow.close()
            }
          })
      }
    } catch {
      /* 无配置文件时按默认行为 */
    }
  })

  // 应用持久化的窗口表现与系统设置
  void ctx.settings.get().then((s) => {
    applyWindowUi(s)
    applySystemSettings(s)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ctx = new AppContext(app.getPath('userData'))
  registerIpcHandlers(ctx)
  void ctx.mcp.start().catch((err) => {
    console.error('MCP 服务启动失败:', err)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    const windows = BrowserWindow.getAllWindows()
    if (windows.length === 0) {
      createWindow()
    } else {
      for (const win of windows) {
        if (!win.isVisible()) win.show()
      }
    }
  })
})

app.on('before-quit', () => {
  quitting = true
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
