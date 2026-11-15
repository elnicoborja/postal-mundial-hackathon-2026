export class CaptureSession {
  #frames = [];
  #confirmed = false;
  #epoch = 0;
  #status = 'idle';
  #selected = null;
  #output = null;
  constructor({ createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL, maxBytes = 32 * 1024 * 1024 } = {}) {
    this.createUrl = createUrl;
    this.revokeUrl = revokeUrl;
    this.maxBytes = maxBytes;
  }
  get frames() { return this.#frames.slice(); }
  get status() { return this.#status; }
  get selected() { return this.#selected; }
  get output() { return this.#output; }
  get bytes() { return this.#frames.reduce((sum, frame) => sum + frame.blob.size, 0); }
  confirmAdults(value) { this.#confirmed = value === true; }
  begin() {
    if (!this.#confirmed) throw new Error('CAPTURE_CONFIRMATION');
    if (this.#status !== 'idle') throw new Error('RESET_REQUIRED');
    this.#status = 'capturing';
    return ++this.#epoch;
  }
  accept(epoch, frame) {
    if (epoch !== this.#epoch || this.#status !== 'capturing' || this.#frames.length >= 30) return false;
    if (!(frame.blob instanceof Blob) || !frame.blob.size || frame.blob.type !== 'image/jpeg'
        || !Number.isInteger(frame.width) || !Number.isInteger(frame.height)
        || frame.width < 1 || frame.height < 1 || frame.width * frame.height > 1280 * 720) throw new Error('INVALID_FRAME');
    if (this.bytes + frame.blob.size > this.maxBytes) return false;
    this.#frames.push(Object.freeze({ ...frame, url: this.createUrl(frame.blob), id: this.#frames.length + 1 }));
    return true;
  }
  finish(epoch) { if (epoch === this.#epoch && this.#status === 'capturing') this.#status = this.#frames.length ? 'review' : 'idle'; }
  select(id) {
    if (this.#status !== 'review') throw new Error('REVIEW_REQUIRED');
    const frame = this.#frames.find(frame => frame.id === id);
    if (!frame) throw new Error('UNKNOWN_FRAME');
    this.#selected = frame;
  }
  async lock(transform) {
    if (this.#status !== 'review' || !this.#selected) throw new Error('SELECTION_REQUIRED');
    const epoch = this.#epoch;
    this.#status = 'locking';
    try {
      const result = await transform(this.#selected);
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await result.blob.arrayBuffer()))]
        .map(value => value.toString(16).padStart(2, '0')).join('');
      if (epoch !== this.#epoch) throw new Error('SESSION_RESET');
      this.#output = Object.freeze({ blob: result.blob, preview: result.preview, width: result.width,
        height: result.height, filter: result.filter, frameId: this.#selected.id, digest,
        url: this.createUrl(result.blob), previewUrl: this.createUrl(result.preview) });
      this.#status = 'locked';
      return this.#output;
    } catch (error) {
      if (epoch === this.#epoch) this.#status = 'review';
      throw error;
    }
  }
  reset() {
    ++this.#epoch;
    for (const frame of this.#frames) this.revokeUrl(frame.url);
    if (this.#output) { this.revokeUrl(this.#output.url); this.revokeUrl(this.#output.previewUrl); }
    this.#frames = [];
    this.#selected = null;
    this.#output = null;
    this.#confirmed = false;
    this.#status = 'idle';
  }
}
