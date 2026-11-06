// Which copy of the app is this? The test version lives under /test/ on the same website,
// so it shares the browser's storage with the real app. Everything it saves gets its own
// prefix so testing can never touch the real collection.
export const IS_TEST = /\/test(\/|$)/.test(location.pathname);
export const KEY_PREFIX = IS_TEST ? 'pu-test:' : 'pu:';
