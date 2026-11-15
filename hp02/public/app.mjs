import { CaptureSession } from './session.mjs';
import { Camera, prepareOutput } from './camera.mjs';

const $ = id => document.getElementById(id);
const session = new CaptureSession();
const camera = new Camera($('video'));
let run = 0;
let opening = false;
let cameraReady = false;
let captureEpoch;
const messages = {
  NotAllowedError: 'No se concedió permiso de cámara. Revisa el permiso del navegador y vuelve a activar la cámara.',
  NotFoundError: 'No encontramos una cámara. Conecta una cámara y reintenta.',
  NotReadableError: 'La cámara está ocupada o no responde. Cierra otras aplicaciones que la usen y reintenta.',
  CAMERA_UNSUPPORTED: 'Este navegador no permite la cámara aquí. Abre la dirección local en un navegador compatible.',
  CAMERA_TIMEOUT: 'La solicitud de cámara venció. Revisa el permiso y vuelve a intentarlo.',
  FRAME_TIMEOUT: 'No llegó una imagen nueva. Conservamos las tomas aceptadas; revisa la cámara antes de otra sesión.',
  ENCODE_FAILED: 'No pudimos preparar otra imagen. Conservamos las tomas aceptadas. Prueba una secuencia más corta.',
  CAPTURE_STOPPED: 'Cámara detenida. Conservamos las tomas ya aceptadas.',
  SESSION_RESET: 'Sesión reiniciada. La selección anterior ya no está disponible.'
};
const say = text => { $('status').textContent = text; };
const errorText = error => messages[error.name] || messages[error.message] || 'No se completó la acción. Puedes reiniciar y volver a intentarlo.';

function render() {
  const state = session.status;
  const busy = opening || state === 'capturing' || state === 'locking';
  document.body.dataset.state = state;
  $('start-camera').disabled = !$('adult-confirm').checked || busy || cameraReady || state !== 'idle';
  $('stop-camera').disabled = !opening && !cameraReady && state !== 'capturing';
  $('capture').disabled = !cameraReady || busy || state !== 'idle';
  $('burst-count').disabled = busy || state !== 'idle';
  $('adult-confirm').disabled = busy || state !== 'idle' || cameraReady;
  $('camera-placeholder').hidden = cameraReady;
  $('review').hidden = !session.frames.length;
  $('output').hidden = state !== 'locked';
  $('lock').disabled = state !== 'review' || !session.selected;
  $('filter').disabled = state !== 'review';
  $('download').disabled = state !== 'locked';
  $('delivery-confirm').disabled = state !== 'locked';
  $('count').textContent = `${session.frames.length} tomas aceptadas · ${(session.bytes / (1024 * 1024)).toFixed(1)} MiB`;
  document.querySelectorAll('[data-frame]').forEach(button => {
    button.disabled = state !== 'review';
    button.setAttribute('aria-pressed', String(Number(button.dataset.frame) === session.selected?.id));
  });
}
function gallery() {
  $('gallery').replaceChildren();
  for (const frame of session.frames) {
    const button = document.createElement('button');
    button.className = 'frame'; button.dataset.frame = String(frame.id);
    button.setAttribute('aria-label', `Elegir toma ${frame.id}, ${frame.width} por ${frame.height} píxeles`);
    const image = document.createElement('img');
    image.src = frame.url; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
    const label = document.createElement('span'); label.textContent = `${String(frame.id).padStart(2, '0')} · ${frame.width} × ${frame.height}`;
    button.append(image, label);
    button.addEventListener('click', () => {
      session.select(frame.id);
      $('selected-image').src = frame.url; $('selected-image').hidden = false;
      $('selection-placeholder').hidden = true;
      $('selected-label').textContent = `Toma ${frame.id} seleccionada`;
      $('selected-details').textContent = `Archivo: ${frame.width} × ${frame.height} px. Cámara: ${frame.sourceWidth} × ${frame.sourceHeight} px.`;
      render();
    });
    $('gallery').append(button);
  }
}
function stopCamera() {
  ++run; opening = false; cameraReady = false;
  camera.stop(); session.finish(captureEpoch);
  gallery(); render();
  $('camera-details').textContent = 'Cámara detenida. Audio desactivado.';
  say('Cámara detenida. Conservamos las tomas ya aceptadas.');
}
function reset() {
  ++run; opening = false; cameraReady = false;
  camera.stop(); session.reset();
  $('adult-confirm').checked = false; $('delivery-confirm').checked = false;
  $('delivery-status').textContent = 'Entrega no autorizada. No se ha subido ningún archivo.';
  for (const id of ['selected-image', 'final-image']) $(id).removeAttribute('src');
  $('selected-image').hidden = true; $('selection-placeholder').hidden = false;
  $('selected-label').textContent = 'Sin selección'; $('selected-details').textContent = '';
  $('digest').textContent = ''; $('output-details').textContent = '';
  $('filter').value = 'original';
  $('camera-details').textContent = 'Sin acceso a la cámara. Audio desactivado.';
  gallery(); render();
  say('Sesión reiniciada. Cámara detenida y referencias a fotos liberadas. Las descargas ya guardadas no se borran.');
}
$('adult-confirm').addEventListener('change', () => { session.confirmAdults($('adult-confirm').checked); render(); });
$('start-camera').addEventListener('click', async () => {
  if ($('start-camera').disabled) return;
  const current = ++run; opening = true; render(); say('Esperando el permiso de cámara del navegador. Puedes cancelar con Detener cámara.');
  try {
    const stream = await camera.open();
    if (current !== run) return;
    cameraReady = true;
    for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => { if (current === run || camera.stream === stream) stopCamera(); }, { once: true });
    const settings = stream.getVideoTracks()[0].getSettings();
    $('camera-details').textContent = `Cámara activa: ${settings.width || $('video').videoWidth} × ${settings.height || $('video').videoHeight} px. Audio desactivado.`;
    say('Encuadra solo a las personas adultas que aceptaron participar. La cámara se detiene al terminar la secuencia.');
  } catch (error) { if (current === run) say(errorText(error)); }
  finally { if (current === run) { opening = false; render(); } }
});
$('capture').addEventListener('click', async () => {
  if ($('capture').disabled) return;
  const target = Number($('burst-count').value);
  if (!Number.isInteger(target) || target < 1 || target > 30) { say('Elige un número entero entre 1 y 30.'); return; }
  const current = ++run;
  captureEpoch = session.begin(); render();
  try {
    for (let i = 0; i < target && current === run; i++) {
      const frame = await camera.snapshot();
      if (current !== run) break;
      if (!session.accept(captureEpoch, frame)) { say('Se alcanzó el límite de memoria. Conservamos solo las tomas aceptadas.'); break; }
      render(); say(`Toma ${session.frames.length} aceptada de un máximo de ${target}.`);
      if (i < target - 1) await new Promise(resolve => setTimeout(resolve, 180));
    }
  } catch (error) { if (current === run) say(errorText(error)); }
  finally {
    if (current === run) {
      camera.stop(); cameraReady = false; session.finish(captureEpoch);
      $('camera-details').textContent = 'Cámara detenida al terminar la secuencia.';
      gallery(); render();
      if (session.frames.length === target) say(`${target} tomas aceptadas. Revisa todas y elige una.`);
    }
  }
});
$('stop-camera').addEventListener('click', stopCamera);
$('reset').addEventListener('click', reset);
$('lock').addEventListener('click', async () => {
  if ($('lock').disabled) return;
  const current = run;
  const pending = session.lock(frame => prepareOutput(frame, $('filter').value));
  render(); say('Preparando el archivo final y su huella local…');
  try {
    const output = await pending;
    if (current !== run) return;
    $('final-image').src = output.url;
    $('digest').textContent = output.digest;
    $('output-details').textContent = `Toma ${output.frameId} · ${output.width} × ${output.height} px · ${output.blob.size} bytes · ${output.filter === 'mono' ? 'Blanco y negro' : 'Original'}. Selección fija.`;
    say('Selección fija. Puedes guardar exactamente este archivo. No se ha enviado a ningún servidor.');
    render(); $('output').scrollIntoView({ behavior: 'instant', block: 'start' });
  } catch (error) { if (current === run) { say(errorText(error)); render(); } }
});
$('delivery-confirm').addEventListener('change', () => {
  $('delivery-status').textContent = $('delivery-confirm').checked
    ? 'Revisión de entrega registrada solo en esta pestaña. No hay destinatarios, pago ni subida de archivos.'
    : 'Entrega no autorizada. No se ha subido ningún archivo.';
});
$('download').addEventListener('click', () => {
  const output = session.output;
  if (!output) return;
  const link = document.createElement('a'); link.href = output.url;
  link.download = `postal-toma-${output.frameId}-${output.digest.slice(0, 12)}.jpg`;
  link.click();
});
window.addEventListener('pagehide', reset);
document.addEventListener('visibilitychange', () => { if (document.hidden && (cameraReady || opening || session.status === 'capturing')) stopCamera(); });
render();
