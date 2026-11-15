const { EventEmitter } = require('node:events');
const { createClient } = require('../auth/session');

class ConnectionLayer extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = 'connection';
    this.enabled = opts.enabled !== false;
    this.client = opts.client || null;
    this.opts = opts;
    this.connected = false;
  }

  async start() {
    if (!this.enabled) return;
    if (!this.client) {
      this.client = createClient(this.opts);
    }
    if (!this.client.connected) {
      await this.client.connect();
    }
    this.connected = true;
    this.emit('connected', { client: this.client });
    return this.client;
  }

  stop() {
    if (this.client && this.connected) {
      this.client.disconnect();
      this.connected = false;
      this.emit('disconnected');
    }
  }

  getClient() {
    return this.client;
  }
}

module.exports = { ConnectionLayer };
