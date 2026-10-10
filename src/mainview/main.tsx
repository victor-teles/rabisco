import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// The editor is a fixed shell; its panels scroll, the page never does. Anything that grows past the
// window (a popover near an edge, a tall hidden frame) would let a focus or `scrollIntoView` shift it all up
window.addEventListener("scroll", () => {
	if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
});

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
