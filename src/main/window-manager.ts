import { app, BrowserWindow, Menu, screen, Tray } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";

export class WindowManager {
  private mainWindow: BrowserWindow | undefined;
  private overlayWindow: BrowserWindow | undefined;
  private ballWindow: BrowserWindow | undefined;
  private tray: Tray | undefined;
  private onTrayToggle: (() => void) | undefined;

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

    const gap = 10;
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    this.overlayWindow = new BrowserWindow({
      width: 420,
      height: 540,
      x: gap,
      y: Math.round((screenHeight - 540) / 2),
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

    this.ballWindow = new BrowserWindow({
      width: 56,
      height: 56,
      x: gap,
      y: Math.round((screenHeight - 56) / 2),
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: !options.overlayVisible,
      focusable: false,
      resizable: false,
      icon: windowIcon,
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: !app.isPackaged,
      },
    });

    this.ballWindow.on("closed", () => {
      this.ballWindow = undefined;
    });

    if (rendererUrl) {
      void this.mainWindow.loadURL(rendererUrl);
      void this.overlayWindow.loadURL(`${rendererUrl}?view=overlay`);
      void this.ballWindow.loadURL(`${rendererUrl}?view=ball`);
    } else {
      void this.mainWindow.loadFile(rendererFile);
      void this.overlayWindow.loadFile(rendererFile, { query: { view: "overlay" } });
      void this.ballWindow.loadFile(rendererFile, { query: { view: "ball" } });
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

  createTray(onToggle: () => void): void {
    this.onTrayToggle = onToggle;
    const iconPath = this.resolveWindowIconPath();
    if (!iconPath) return;
    this.tray = new Tray(iconPath);
    this.tray.setToolTip("炉石对局 Agent 助手");
    this.tray.on("click", onToggle);
    this.refreshTrayMenu();
  }

  private refreshTrayMenu(): void {
    if (!this.tray) return;
    const isVisible = this.overlayWindow?.isVisible() ?? false;
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: isVisible ? "隐藏悬浮窗" : "显示悬浮窗",
          click: () => this.onTrayToggle?.(),
        },
        { type: "separator" },
        { label: "退出", click: () => app.quit() },
      ]),
    );
  }

  toggleOverlayVisible(): boolean {
    this.setOverlayVisible(!this.overlayWindow?.isVisible());
    return Boolean(this.overlayWindow?.isVisible());
  }

  setOverlayVisible(visible: boolean): void {
    if (visible) {
      this.repositionOverlay();
      this.overlayWindow?.showInactive();
      this.ballWindow?.hide();
    } else {
      this.overlayWindow?.hide();
      this.ballWindow?.showInactive();
      this.repositionBall();
    }
    this.refreshTrayMenu();
  }

  private repositionOverlay(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
    const gap = 10;
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    this.overlayWindow.setPosition(gap, Math.round((screenHeight - 540) / 2));
  }

  private repositionBall(): void {
    if (!this.ballWindow || this.ballWindow.isDestroyed()) return;
    const gap = 10;
    const { height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    this.ballWindow.setPosition(gap, Math.round((screenHeight - 56) / 2));
  }

  broadcast<T>(channel: string, payload: T): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload);
    }
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.send(channel, payload);
    }
    if (this.ballWindow && !this.ballWindow.isDestroyed()) {
      this.ballWindow.webContents.send(channel, payload);
    }
  }

  private resolveWindowIconPath(): string | undefined {
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, "build", "icon.ico")
      : join(app.getAppPath(), "build", "icon.ico");
    return existsSync(iconPath) ? iconPath : undefined;
  }
}
