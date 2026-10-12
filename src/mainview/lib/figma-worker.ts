import { FigmaFormatError, readFigmaClipboard, UNREADABLE_FIGMA } from "../../shared/import/figma/clipboard";
import { figmaToCaptured } from "../../shared/import/figma/to-captured";

addEventListener("message", (event: MessageEvent<string>) => {
	try {
		const { screens, tokens, placeholders } = figmaToCaptured(readFigmaClipboard(event.data).message);

		postMessage({ trees: screens.map((screen) => JSON.stringify(screen)), tokens, placeholders });
	} catch (error) {
		postMessage({ error: error instanceof FigmaFormatError ? error.message : UNREADABLE_FIGMA });
	}
});
