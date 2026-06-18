import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ipc } from "@/lib/ipc";
import { isMacOS, isLinux } from "@/lib/platform";
import "@xterm/xterm/css/xterm.css";

// Pick a monospace font family that ships natively on each OS so the
// embedded terminal never falls back to a slab default. JetBrains Mono
// stays as the preferred override when the user has it installed.
function monoFontFamily(): string {
  if (isMacOS()) return '"JetBrains Mono", Menlo, "SF Mono", monospace';
  if (isLinux()) return '"JetBrains Mono", "DejaVu Sans Mono", "Noto Mono", monospace';
  return '"JetBrains Mono", "Cascadia Mono", Consolas, monospace';
}

interface Props {
  sessionId: string;
  actionId: number;
  onExit?: () => void;
}

export function EmbeddedTerminal({ sessionId, actionId, onExit }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new Terminal({
      fontFamily: monoFontFamily(),
      fontSize: 12,
      cursorBlink: true,
      theme: {
        background: "#0a0a14",
        foreground: "#d8dee9",
        cursor: "#22d3ee",
      },
      // ConPTY (Windows) and openpty (macOS/Linux) both emit canonical
      // line endings already — extra CR injection here would double up
      // newlines on POSIX. Off everywhere.
      convertEol: false,
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
      // Spawn the process here — AFTER the output listener is attached, so
      // no early output is missed — and ONLY here (single spawn path). The
      // backend is idempotent per session id, so React StrictMode's effect
      // re-run in dev is a harmless no-op rather than a second racing shell.
      try {
        await ipc.runActionEmbedded(actionId, sessionId, term.rows, term.cols);
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
      // Do NOT ptyKill here. The session lifecycle is owned explicitly by
      // the Stop/Close buttons and run-replacement (all call ptyKill). A
      // StrictMode unmount/remount must not tear down the live process —
      // that's what previously killed the session mid-run.
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
