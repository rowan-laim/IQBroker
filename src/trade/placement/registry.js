/**
 * Placer Registry
 *
 * A "placer" for a product (turbo/blitz/binary/digital/...) implements:
 *   prepare(ctx) -> { expired, expirationSize?, ...meta }   (may be async)
 *   place(ctx, prepared) -> Promise<brokerResponse>
 *
 * prepare() must be pure/side-effect-free wherever possible (it may await
 * an injected async lookup like a digital-instrument fetch, but it must
 * never call the broker's buy endpoint). place() is the only place a buy
 * call happens. Keeping these separate is what lets tradeEngine.js run
 * duration validation between them, unconditionally, for every product.
 *
 * New products (or a swapped-out implementation of an existing one, e.g.
 * for a different broker) register here without touching tradeEngine.js,
 * durationGuard.js, or executionGuard.js.
 */

const placers = new Map();

function registerPlacer(product, placer) {
  if (!product || typeof product !== 'string') {
    throw new Error('registerPlacer: product name is required');
  }
  if (typeof placer?.prepare !== 'function' || typeof placer?.place !== 'function') {
    throw new Error(`registerPlacer("${product}"): placer must implement prepare(ctx) and place(ctx, prepared)`);
  }
  placers.set(product, placer);
}

function getPlacer(product) {
  const placer = placers.get(product);
  if (!placer) {
    throw new Error(`No placer registered for product "${product}". Registered: [${[...placers.keys()].join(', ')}]`);
  }
  return placer;
}

function listProducts() {
  return [...placers.keys()];
}

function _resetForTests() {
  placers.clear();
}

module.exports = { registerPlacer, getPlacer, listProducts, _resetForTests };
