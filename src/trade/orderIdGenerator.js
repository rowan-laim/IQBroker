/**
 * OrderIdGenerator
 *
 * Produces short, human-readable, incremental order IDs in the format:
 *   {PrefixLetter}{3-digit-counter}{2-RandomLetters}
 *
 * Examples: A100GH  A101XQ  A102YZ  ...  A999KL  B100GH  B101XQ  ...
 *
 * Rules:
 *  - Counter runs 100 → 999 (900 IDs per prefix letter)
 *  - Prefix cycles A → B → … → Z → A (26 × 900 = 23,400 unique combinations per suffix pair)
 *  - 2 random uppercase suffix letters add collision resistance within the same counter slot
 *  - Entirely in-memory; resets cleanly on process restart (fine for a session-scoped executor)
 */
class OrderIdGenerator {
  /**
   * @param {object} [opts]
   * @param {number} [opts.startCounter=100] - first counter value (100..999)
   * @param {string} [opts.prefix='A']       - starting prefix letter
   */
  constructor({ startCounter = 100, prefix = 'A' } = {}) {
    this._counter = Math.max(100, Math.min(999, Number(startCounter)));
    this._prefixCode = (prefix || 'A').toUpperCase().charCodeAt(0); // 65='A'
    if (this._prefixCode < 65 || this._prefixCode > 90) this._prefixCode = 65;
  }

  /** Two random uppercase letters (A-Z). */
  _suffix() {
    return String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
           String.fromCharCode(65 + Math.floor(Math.random() * 26));
  }

  /**
   * Returns the next unique order ID, e.g. "A100GH".
   * @returns {string}
   */
  next() {
    if (this._counter > 999) {
      this._counter = 100;
      // Cycle prefix A→B→…→Z→A
      this._prefixCode = this._prefixCode < 90 ? this._prefixCode + 1 : 65;
    }
    const id = `${String.fromCharCode(this._prefixCode)}${this._counter}${this._suffix()}`;
    this._counter++;
    return id;
  }

  /** Peek at what the NEXT id will look like (without advancing the counter). */
  peek() {
    const counter = this._counter > 999 ? 100 : this._counter;
    const prefixCode = this._counter > 999
      ? (this._prefixCode < 90 ? this._prefixCode + 1 : 65)
      : this._prefixCode;
    return `${String.fromCharCode(prefixCode)}${counter}**`;
  }
}

module.exports = { OrderIdGenerator };
