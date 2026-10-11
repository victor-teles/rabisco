let state = "";

const listeners = new Set<() => void>();

export const styleState = {
	current: () => state,
	set: (next: string) => {
		if (next === state) return;

		state = next;

		for (const listener of listeners) listener();
	},
	subscribe: (listener: () => void) => {
		listeners.add(listener);

		return () => void listeners.delete(listener);
	},
};
