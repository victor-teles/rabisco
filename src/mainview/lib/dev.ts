/** Vite's dev server, or the app's dev channel, which loads a production build (`hutch run start`) */
export const isDevelopment = import.meta.env.DEV || location.hash.includes("channel=dev");
