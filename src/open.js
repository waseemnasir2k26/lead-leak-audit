import { execFile } from "node:child_process";

/**
 * How to open a file with the OS default app. The path is always ONE argv element and is never
 * passed through a shell, so characters such as & ^ % ( ) or spaces cannot be interpreted.
 */
export function openCommand(file, platform = process.platform) {
  if (platform === "win32") return { cmd: "explorer.exe", args: [file] };
  if (platform === "darwin") return { cmd: "open", args: [file] };
  return { cmd: "xdg-open", args: [file] };
}

/** Best effort, never throws. `exec` is injectable for tests. */
export function openFile(
  file,
  { platform = process.platform, exec = execFile } = {},
) {
  const { cmd, args } = openCommand(file, platform);
  try {
    const child = exec(cmd, args, { shell: false, windowsHide: false }, () => {
      /* explorer.exe exits 1 even on success; the path is printed anyway */
    });
    child?.unref?.();
    return { cmd, args };
  } catch {
    return null;
  }
}
