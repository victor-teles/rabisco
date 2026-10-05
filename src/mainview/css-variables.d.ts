import "react";

declare module "react" {
	interface CSSProperties {
		/** CSS custom properties, e.g. `style={{ "--gap": 2 }}` */
		[name: `--${string}`]: string | number | undefined;
	}
}
