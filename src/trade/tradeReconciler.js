/**
 * Trade Reconciler
 *
 * Listens to live WebSocket pushes:
 *   - `portfolio.position-changed` (positions created or modified)
 *   - `balances.balance-changed` (balance deductions or credits)
 *
 * Correlates trade placement intents with incoming WebSocket events.
 * Even if an order placement call returns no ID, times out, or has network jitter,
 * this reconciler finds the active position in the WebSocket stream, matches it
 * by activeId + direction + stake + timestamp window, extracts the authoritative
 * broker order ID and exact entry price (open_quote), and verifies that balance
 * was debited from the account.
 */

class TradeReconciler {
  constructor({ maxEvents = 100, windowMs = 6000 } = {}) {
    this.maxEvents = maxEvents;
    this.windowMs = windowMs;
    this.recentPositions = []; // { id, order_id, active_id, dir, invest, open_quote, open_time, receivedAt }
    this.recentBalances = []; // { id, amount, delta, ts }
    this.subscriptions = [];
  }

  attach(client) {
    if (!client) return;

    // 1. Capture live position changes
    if (typeof client.onPositionChanged === 'function') {
      const posSub = client.onPositionChanged((pos) => {
        if (!pos) return;
        this.recordPositionEvent(pos);
      });
      if (posSub) this.subscriptions.push(posSub);
    }

    // 2. Capture live balance changes
    if (typeof client.onBalanceChanged === 'function') {
      const balSub = client.onBalanceChanged((bal) => {
        if (!bal) return;
        this.recordBalanceEvent(bal);
      });
      if (balSub) this.subscriptions.push(balSub);
    }
  }

  recordPositionEvent(pos) {
    const entry = {
      id: pos.id != null ? String(pos.id) : null,
      order_id: pos.order_id != null ? Number(pos.order_id) : (Number(pos.id) || null),
      active_id: Number(pos.active_id ?? pos.activeId),
      dir: String(pos.dir || pos.direction || '').toLowerCase(),
      invest: Number(pos.invest ?? pos.amount ?? pos.price ?? 0),
      open_quote: Number(pos.open_quote ?? pos.openPrice ?? pos.quote ?? 0),
      open_time: Number(pos.open_time || Math.floor(Date.now() / 1000)),
      raw: pos,
      receivedAt: Date.now(),
    };

    this.recentPositions.unshift(entry);
    if (this.recentPositions.length > this.maxEvents) {
      this.recentPositions.pop();
    }
  }

  recordBalanceEvent(bal) {
    const prev = this.recentBalances[0]?.amount ?? null;
    const current = Number(bal.amount ?? bal.cash ?? 0);
    const delta = prev != null ? current - prev : null;

    const entry = {
      id: bal.id,
      amount: current,
      delta: Number.isFinite(delta) ? delta : null,
      ts: Date.now(),
      raw: bal,
    };

    this.recentBalances.unshift(entry);
    if (this.recentBalances.length > this.maxEvents) {
      this.recentBalances.pop();
    }
  }

  /**
   * Reconciles an uncertain or missing-ID order against recent WebSocket events.
   *
   * @param {object} intent
   * @param {number} intent.activeId
   * @param {string} intent.direction - 'call' | 'put'
   * @param {number} intent.stake
   * @param {number} [intent.initiatedAt] - epoch ms
   * @param {number} [intent.windowMs]
   * @returns {object|null} Reconciled order details or null
   */
  reconcile({ activeId, direction, stake, initiatedAt = Date.now(), windowMs = this.windowMs }) {
    const targetActive = Number(activeId);
    const targetDir = String(direction).toLowerCase();
    const targetStake = Number(stake);
    const minTime = initiatedAt - 2000;
    const maxTime = Date.now() + 2000;

    // 1. Search recent position events
    const matchedPosition = this.recentPositions.find((pos) => {
      if (pos.active_id !== targetActive) return false;
      if (pos.dir && pos.dir !== targetDir) return false;
      if (targetStake > 0 && Math.abs(pos.invest - targetStake) > 0.05) return false;

      const posTimeMs = pos.receivedAt || (pos.open_time * 1000);
      if (posTimeMs < minTime || posTimeMs > maxTime + windowMs) return false;

      return true;
    });

    // 2. Correlate recent balance changes (deduction equal to stake)
    const matchedBalance = this.recentBalances.find((bal) => {
      if (bal.ts < minTime || bal.ts > maxTime + windowMs) return false;
      if (targetStake > 0 && bal.delta != null) {
        // Delta should be negative and close to -stake
        return Math.abs(Math.abs(bal.delta) - targetStake) < 0.05;
      }
      return false;
    });

    if (matchedPosition) {
      const orderId = matchedPosition.order_id || matchedPosition.id;
      return {
        reconciled: true,
        recovered: true,
        orderId,
        id: orderId,
        exactEntryPrice: matchedPosition.open_quote,
        openQuote: matchedPosition.open_quote,
        positionId: matchedPosition.id,
        balanceDeductionConfirmed: Boolean(matchedBalance),
        balanceChange: matchedBalance,
        position: matchedPosition,
      };
    }

    if (matchedBalance) {
      // Balance was debited, confirming trade execution occurred even if position push was delayed
      return {
        reconciled: true,
        recovered: true,
        orderId: null,
        exactEntryPrice: null,
        balanceDeductionConfirmed: true,
        balanceChange: matchedBalance,
      };
    }

    return null;
  }

  detach() {
    for (const sub of this.subscriptions) {
      try {
        if (typeof sub?.unsubscribe === 'function') sub.unsubscribe();
      } catch (_) {}
    }
    this.subscriptions = [];
    this.recentPositions = [];
    this.recentBalances = [];
  }
}

module.exports = {
  TradeReconciler,
};
