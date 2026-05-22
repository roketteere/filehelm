import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ipc } from "@/lib/ipc";
import "@xterm/xterm/css/xterm.css";

interface Props {
  sessionId: string;
  cwd: string;
  command: string;
  onExit?: () => void;
}

export function EmbeddedTerminal({ sessionId, cwd, command, onExit }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Consolas", monospace',
      fontSize: 12,
      cursorBlink: true,
      theme: {
        background: "#0a0a14",
        foreground: "#d8dee9",
        cursor: "#22d3ee",
      },
      convertEol: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    // Send anything the user types into the backend writer.
    term.onData((data) => {
      ipc.ptyWrite(sessionId, data).catch(() => {
        // ignore — session might have ended
      });
    });
    // Resize the backend PTY when the front resizes.
    term.onResize(({ cols, rows }) => {
      ipc.ptyResize(sessionId, rows, cols).catch(() => {});
    });

    let unlisten: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    (async () => {
      const webview = getCurrentWebview();
      unlisten = await webview.listen<{ session: string; data: string }>(
        `filehelm:pty:${sessionId}`,
        (event) => {
          term.write(event.payload.data);
        },
      );
      unlistenExit = await webview.listen<{ session: string; code: number | null }>(
        `filehelm:pty-exit:${sessionId}`,
        () => {
          term.writeln("\r\n\x1b[2;37m[process exited]\x1b[0m");
          onExit?.();
        },
      );
      // Kick off the process.
      const cols = term.cols;
      const rows = term.rows;
      try {
        await ipc.ptySpawn({ sessionId, cwd, command, rows, cols });
      } catch (e) {
        term.writeln(`\x1b[31mfilehelm: ${String(e)}\x1b[0m`);
      }
    })();

    const onWinResize = () => fit.fit();
    window.addEventListener("resize", onWinResize);

    return () => {
      window.removeEventListener("resize", onWinResize);
      if (unlisten) unlisten();
      if (unlistenExit) unlistenExit();
      ipc.ptyKill(sessionId).catch(() => {});
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return (
    <div
      ref={hostRef}
      className="h-full w-full overflow-hidden rounded-md bg-[#0a0a14] p-2"
    />
  );
}
