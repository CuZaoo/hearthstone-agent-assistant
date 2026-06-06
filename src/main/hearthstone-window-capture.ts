import { desktopCapturer, type NativeImage } from "electron";

export async function captureHearthstoneWindow(): Promise<NativeImage> {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 2560, height: 1440 },
    fetchWindowIcons: false,
  });
  const source = sources.find((entry) => /hearthstone|炉石传说/i.test(entry.name));
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error("未找到炉石传说窗口，请使用窗口化或无边框模式。");
  }
  return source.thumbnail;
}
