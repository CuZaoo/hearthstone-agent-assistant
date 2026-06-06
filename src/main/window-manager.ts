import { app, BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";

export class WindowManager {
  private mainWindow: BrowserWindow | undefined;
  private overlayWindow: BrowserWindow | undefined;

  createWindows(options: { overlayVisible: boolean }): void {
    const preload = join(import.meta.dirname, "preload.cjs");
    const rendererUrl = process.env.VITE_DEV_SERVER_URL;
    const rendererFile = join(app.getAppPath(), "dist", "renderer", "index.html");
    const windowIcon = this.resolveWindowIconPath();

    this.mainWindow = new BrowserWindow({
      width: 960,
      height: 700,
      minWidth: 820,
      minHeight: 640,
      frame: false,
      icon: windowIcon,
      title: "炉石对局 Agent 助手",
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: !app.isPackaged,
      },
    });

    const [mainX = 0, mainY = 0] = this.mainWindow.getPosition();
    this.overlayWindow = new BrowserWindow({
      width: 420,
      height: 540,
      x: mainX - 420,
      y: mainY + 30,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: options.overlayVisible,
      focusable: false,
      icon: windowIcon,
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: !app.isPackaged,
      },
    });

    this.mainWindow.on("closed", () => {
      this.mainWindow = undefined;
      app.quit();
    });
    this.overlayWindow.on("closed", () => {
      this.overlayWindow = undefined;
    });

    if (rendererUrl) {
      void this.mainWindow.loadURL(rendererUrl);
      void this.overlayWindow.loadURL(`${rendererUrl}?view=overlay`);
    } else {
      void this.mainWindow.loadFile(rendererFile);
      void this.overlayWindow.loadFile(rendererFile, { query: { view: "overlay" } });
    }
  }

  getMainWindow(): BrowserWindow | undefined {
    return this.mainWindow;
  }

  focusMainWindow(): void {
    if (!this.mainWindow) return;
    if (this.mainWindow.isMinimized()) this.mainWindow.restore();
    this.mainWindow.focus();
  }

  toggleMainWindow(): void {
    if (!this.mainWindow) return;
    if (this.mainWindow.isVisible()) {
      this.mainWindow.hide();
      return;
    }
    this.mainWindow.show();
    this.mainWindow.focus();
  }

  minimizeMainWindow(): void {
    this.mainWindow?.minimize();
  }

  toggleMainWindowMaximized(): void {
    if (this.mainWindow?.isMaximized()) this.mainWindow.unmaximize();
    else this.mainWindow?.maximize();
  }

  closeMainWindow(): void {
    this.mainWindow?.close();
  }

  toggleOverlayVisible(): boolean {
    this.setOverlayVisible(!this.overlayWindow?.isVisible());
    return Boolean(this.overlayWindow?.isVisible());
  }

  setOverlayVisible(visible: boolean): void {
    if (visible) {
      this.overlayWindow?.showInactive();
    } else {
      this.overlayWindow?.hide();
    }
  }

  broadcast<T>(channel: string, payload: T): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload);
    }
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.send(channel, payload);
    }
  }

  private resolveWindowIconPath(): string | undefined {
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, "build", "icon.ico")
      : join(app.getAppPath(), "build", "icon.ico");
    return existsSync(iconPath) ? iconPath : undefined;
  }
}
