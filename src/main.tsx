import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

// NOTE: React.StrictMode is intentionally NOT used. It double-invokes
// effects (mount→cleanup→mount) in dev only, which double-fires our
// native side effects — spawning the embedded PTY twice and double-
// registering Tauri event listeners (the "[process exited] [process
// exited]" / racing-shell bug). The production build never runs
// StrictMode, so removing it makes `pnpm tauri dev` behave exactly like
// the shipped .exe. Effect cleanups are still written correctly.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
