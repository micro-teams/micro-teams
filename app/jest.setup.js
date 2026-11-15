/*
 * Test-only stand-ins for native modules that have no JavaScript implementation under Jest.
 *
 * react-native-mmkv — an in-memory store per id, so storage behaves as on a device within one run.
 */
/* global jest */
jest.mock("react-native-mmkv", () => {
  const stores = new Map();
  return {
    createMMKV: ({ id }) => {
      if (!stores.has(id)) stores.set(id, new Map());
      const m = stores.get(id);
      return {
        getString: (k) => m.get(k),
        set: (k, v) => m.set(k, v),
        remove: (k) => m.delete(k),
      };
    },
  };
});
