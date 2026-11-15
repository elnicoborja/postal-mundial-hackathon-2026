const abortError = () => new Error('CAPTURE_STOPPED');
const encode = canvas => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('ENCODE_FAILED')), 8000);
  canvas.toBlob(blob => { clearTimeout(timer); blob?.size ? resolve(blob) : reject(new Error('ENCODE_FAILED')); }, 'image/jpeg', 0.9);
});

export function boundedSize(width, height) {
  const scale = Math.min(1, 1280 / Math.max(width, height), Math.sqrt(1280 * 720 / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export class Camera {
  constructor(video) { this.video = video; this.generation = 0; this.stream = null; this.canvas = document.createElement('canvas'); }
  async open() {
    this.stop();
    const generation = this.generation;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('CAMERA_UNSUPPORTED');
    let timer;
    const request = navigator.mediaDevices.getUserMedia({ audio: false, video: {
      facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15, max: 30 }
    } }).then(stream => {
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); throw abortError(); }
      return stream;
    });
    try {
      this.stream = await Promise.race([request, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('CAMERA_TIMEOUT')), 20000);
      })]);
      if (generation !== this.generation) throw abortError();
      this.controller = new AbortController();
      this.video.srcObject = this.stream;
      await this.video.play();
      if (generation !== this.generation) throw abortError();
      return this.stream;
    } catch (error) {
      if (generation === this.generation) this.stop();
      throw error;
    } finally { clearTimeout(timer); }
  }
  async snapshot() {
    const generation = this.generation;
    const signal = this.controller?.signal;
    if (!this.stream || signal?.aborted) throw abortError();
    await new Promise((resolve, reject) => {
      let callback;
      let poll;
      const initialTime = this.video.currentTime;
      const done = error => {
        clearTimeout(timer); clearTimeout(poll);
        if (callback !== undefined) this.video.cancelVideoFrameCallback(callback);
        signal.removeEventListener('abort', cancelled);
        error ? reject(error) : resolve();
      };
      const cancelled = () => done(abortError());
      const timer = setTimeout(() => done(new Error('FRAME_TIMEOUT')), 4000);
      signal.addEventListener('abort', cancelled, { once: true });
      if (this.video.requestVideoFrameCallback) callback = this.video.requestVideoFrameCallback(() => done());
      else {
        const check = () => {
          if (this.video.readyState >= 2 && this.video.currentTime !== initialTime) done();
          else poll = setTimeout(check, 50);
        };
        check();
      }
    });
    if (generation !== this.generation) throw abortError();
    const sourceWidth = this.video.videoWidth;
    const sourceHeight = this.video.videoHeight;
    if (!sourceWidth || !sourceHeight) throw new Error('FRAME_TIMEOUT');
    const { width, height } = boundedSize(sourceWidth, sourceHeight);
    this.canvas.width = width; this.canvas.height = height;
    this.canvas.getContext('2d', { alpha: false }).drawImage(this.video, 0, 0, width, height);
    const blob = await encode(this.canvas);
    if (generation !== this.generation) throw abortError();
    return { blob, width, height, sourceWidth, sourceHeight };
  }
  stop() {
    ++this.generation;
    this.controller?.abort();
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.canvas.width = 0; this.canvas.height = 0;
  }
}

export async function prepareOutput(frame, filter) {
  if (!['original', 'mono'].includes(filter)) throw new Error('UNKNOWN_FILTER');
  const bitmap = await createImageBitmap(frame.blob);
  const canvas = document.createElement('canvas');
  const preview = document.createElement('canvas');
  try {
    canvas.width = frame.width; canvas.height = frame.height;
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: filter === 'mono' });
    context.drawImage(bitmap, 0, 0);
    if (filter === 'mono') {
      const image = context.getImageData(0, 0, frame.width, frame.height);
      for (let i = 0; i < image.data.length; i += 4) {
        const gray = Math.round(image.data[i] * 0.2126 + image.data[i + 1] * 0.7152 + image.data[i + 2] * 0.0722);
        image.data[i] = gray; image.data[i + 1] = gray; image.data[i + 2] = gray;
      }
      context.putImageData(image, 0, 0);
    }
    const blob = filter === 'original' ? frame.blob : await encode(canvas);
    const scale = Math.min(1, 400 / Math.max(frame.width, frame.height));
    preview.width = Math.max(1, Math.floor(frame.width * scale));
    preview.height = Math.max(1, Math.floor(frame.height * scale));
    preview.getContext('2d', { alpha: false }).drawImage(canvas, 0, 0, preview.width, preview.height);
    return { blob, preview: await encode(preview), width: frame.width, height: frame.height, filter };
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0; preview.width = 0; preview.height = 0; }
}
