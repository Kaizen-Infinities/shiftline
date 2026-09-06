/**
 * Express serialises responses with JSON.stringify, which throws on BigInt.
 * Imported by app.ts so the API and its tests serialise ids identically.
 */
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};
export {};
