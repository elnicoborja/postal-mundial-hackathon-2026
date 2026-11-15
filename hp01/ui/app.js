'use strict';
const places = {
  balcon: {name:'Balcón del Zócalo',tag:'01 / Candidato para explorar',type:'Terraza de restaurante',description:'Una referencia para explorar la experiencia de una postal con el Zócalo como fondo. El espacio exacto, los permisos y la operación siguen por confirmar.',access:'Acceso por confirmar',capture:'Fotógrafo o teléfono propio',source:'https://balcondelzocalo.com/'},
  torre: {name:'Mirador Torre Latino',tag:'02 / Alternativa de referencia',type:'Mirador urbano',description:'Una alternativa para explorar una vista elevada de la ciudad. Este candidato se refiere al mirador, no al restaurante Miralto ni a Terraza 56. No hay instalación o acuerdo confirmado.',access:'Condiciones por confirmar',capture:'Modo de captura por validar',source:'https://www.miradortorrelatino.com/'}
};
const state = {place:'balcon',screen:'explore',shot:7,highlights:false,delivery:'pending',consent:false};
const screens=['explore','participants','choose','review','delivery'];
const highlighted=[7,16,24];
const imagePath='assets/03-terrace-approach-v1.png';
const $=id=>document.getElementById(id);
const pad=n=>String(n).padStart(2,'0');
function announce(message){$('announcement').textContent=message;}
function showScreen(name){
  if(['choose','review','delivery'].includes(name)&&!window.participantGate.isReady())name='participants';
  state.screen=name;
  screens.forEach((screen,index)=>{$(screen).hidden=screen!==name;const step=document.querySelector(`[data-step="${index}"]`);if(screen===name)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');});
  if(name==='review'){state.consent=false;$('consent').checked=false;$('continue-delivery').disabled=true;$('order-title').textContent=`Toma de ejemplo ${pad(state.shot)}`;$('order-place').textContent=`Referencia de recorrido: ${places[state.place].name}. La ilustración no representa este lugar.`;}
  if(name==='delivery')renderDelivery('pending');
  window.scrollTo(0,0);
  const heading=$(name).querySelector('h1');heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});
  announce(`Paso ${screens.indexOf(name)+1} de 5`);
}
function renderPlaces(){
  $('place-list').innerHTML=Object.entries(places).map(([id,p],i)=>`<button class="place-card" data-place="${id}" aria-pressed="${state.place===id}"><span class="place-index">${pad(i+1)}</span><span><span class="place-tag">${p.type}</span><h3>${p.name}</h3><p>Permiso y operación por confirmar</p><span class="chosen">${state.place===id?'✓ Seleccionado':'Ver candidato →'}</span></span></button>`).join('');
  document.querySelectorAll('.map-pin').forEach(pin=>{const selected=pin.dataset.place===state.place;pin.classList.toggle('selected',selected);pin.setAttribute('aria-pressed',String(selected));});
  const p=places[state.place];
  const picture=state.place==='balcon'?`<img src="${imagePath}" alt="Concepto generado de una terraza con fotógrafo, no es una fotografía del Balcón del Zócalo"><span class="image-label">CONCEPTO GENERADO · NO ES ESTE LUGAR</span>`:`<div class="tower-art"><svg viewBox="0 0 200 300" role="img" aria-label="Silueta esquemática de una torre, no es un plano arquitectónico"><path d="M100 10V50M94 50H106V77H117V93H132V244H147V265H53V244H68V93H83V77H94Z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M70 120H130M70 145H130M70 170H130M70 195H130M70 220H130M90 95V243M110 95V243" stroke="currentColor" stroke-width="1"/><path d="M20 265H180" stroke="currentColor"/></svg></div><span class="image-label">ESQUEMA ILUSTRATIVO · SIN ESCALA</span>`;
  $('place-detail').innerHTML=`<div class="concept-scene">${picture}</div><div class="detail-copy"><p class="eyebrow">${p.tag}</p><h2 id="detail-title">${p.name}</h2><p>${p.description}</p><dl class="facts"><div><dt>Acceso</dt><dd>${p.access}</dd></div><div><dt>Experiencia propuesta</dt><dd>${p.capture}</dd></div></dl><button class="primary" data-action="participants">Configurar personas de ejemplo <span aria-hidden="true">→</span></button><p class="small">Sin reserva, disponibilidad en vivo ni relación comercial confirmada.</p></div>`;
}
function renderShots(){
  const shown=state.highlights?highlighted:Array.from({length:30},(_,i)=>i+1);
  $('shot-grid').innerHTML=shown.map(n=>`<button class="shot" data-shot="${n}" aria-pressed="${n===state.shot}" aria-label="Elegir toma de ejemplo ${pad(n)}${highlighted.includes(n)?', destacada de ejemplo':''}"><img class="shot-picture" src="${imagePath}" alt="" loading="lazy" style="object-position:${35+(n%5)*8}% ${40+(n%3)*8}%">${n===state.shot?'<span class="shot-selected">✓ Elegida</span>':''}<span class="shot-meta"><span>${pad(n)}</span><span class="suggested">${highlighted.includes(n)?'DESTACADA':'EJEMPLO'}</span></span></button>`).join('');
  $('selected-label').textContent=`Toma de ejemplo ${pad(state.shot)}`;
  $('choice-number').textContent=`${pad(state.shot)} / 30`;
  $('selected-reason').textContent=highlighted.includes(state.shot)?'Composición sugerida, dato de ejemplo':'Tu elección, sin etiqueta de destacada';
  $('selected-image').style.objectPosition=`${35+(state.shot%5)*8}% ${40+(state.shot%3)*8}%`;
  $('all-shots').setAttribute('aria-pressed',String(!state.highlights));$('highlights').setAttribute('aria-pressed',String(state.highlights));
  $('gallery-description').textContent=state.highlights?'3 destacadas de ejemplo. Puedes volver a Todas (30) sin perder tu selección.':'30 ejemplos disponibles. Las destacadas son etiquetas de demostración, sin análisis de calidad real.';
}
function renderDelivery(mode){
  state.delivery=mode;
  const copy={pending:['Pendiente de verificación · Demo','Esperando confirmación','En un servicio real, el archivo se habilita después de verificar el pago en el servidor.'],ready:['Entrega lista · Estado simulado','Tu selección, lista para llevar','Esta pantalla representa una entrega confirmada. No se procesó ningún pago. Puedes guardar la ilustración pública de ejemplo.'],failed:['Entrega con error · Demo','Tu selección se conserva','En el flujo propuesto, se reintenta la entrega sin cobrar otra vez. Aquí puedes volver a ver el estado de entrega lista.']}[mode];
  $('delivery-badge').textContent=copy[0];$('delivery-state-title').textContent=copy[1];$('delivery-message').textContent=copy[2];
  $('status-track').innerHTML=[['Selección definida',true],['Confirmación del pago (simulada)',mode!=='pending'],[mode==='failed'?'Entrega pendiente de reintento':'Archivo listo (simulado)',mode==='ready']].map(([label,done],i)=>`<div class="status-row ${done?'done':''}"><span>${done?'✓':i+1}</span>${label}</div>`).join('');
  $('download-demo').disabled=mode!=='ready';document.querySelectorAll('[data-state]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.state===mode)));
  announce(copy[0]);
}
document.addEventListener('click',event=>{
  const placeButton=event.target.closest('[data-place]');if(placeButton){state.place=placeButton.dataset.place;renderPlaces();const replacement=document.querySelector(`.place-card[data-place="${state.place}"]`);if(placeButton.classList.contains('place-card'))replacement.focus({preventScroll:true});announce(`${places[state.place].name}, candidato seleccionado`);}
  const action=event.target.closest('[data-action]');if(action)showScreen(action.dataset.action);
  const shotButton=event.target.closest('[data-shot]');if(shotButton){state.shot=Number(shotButton.dataset.shot);renderShots();document.querySelector(`[data-shot="${state.shot}"]`).focus({preventScroll:true});announce(`Elegida toma de ejemplo ${pad(state.shot)}`);}
  const statusButton=event.target.closest('[data-state]');if(statusButton)renderDelivery(statusButton.dataset.state);
});
$('all-shots').addEventListener('click',()=>{state.highlights=false;renderShots();});
$('highlights').addEventListener('click',()=>{state.highlights=true;renderShots();});
function setMap(visible){$('map-panel').hidden=!visible;document.querySelector('.explore-layout').classList.toggle('list-only',!visible);$('map-view').setAttribute('aria-pressed',String(visible));$('list-view').setAttribute('aria-pressed',String(!visible));announce(visible?'Mapa y lista visibles':'Lista de candidatos visible');}
$('map-view').addEventListener('click',()=>setMap(true));$('list-view').addEventListener('click',()=>setMap(false));
$('consent').addEventListener('change',event=>{state.consent=event.target.checked;$('continue-delivery').disabled=!state.consent;});
$('continue-delivery').addEventListener('click',()=>{if(state.consent)showScreen('delivery');});
$('download-demo').addEventListener('click',()=>{if(state.delivery!=='ready')return;const link=document.createElement('a');link.href=imagePath;link.download='postal-mundial-ilustracion-de-ejemplo.png';link.click();announce('Descarga de ilustración pública de ejemplo solicitada');});
$('reset').addEventListener('click',()=>$('reset-dialog').showModal());$('cancel-reset').addEventListener('click',()=>$('reset-dialog').close());
$('confirm-reset').addEventListener('click',async()=>{$('confirm-reset').disabled=true;$('reset-error').textContent='';try{await window.participantGate.reset();state.place='balcon';state.shot=7;state.highlights=false;state.consent=false;renderPlaces();renderShots();setMap(true);$('reset-dialog').close();showScreen('explore');}catch{$('reset-error').textContent='No se pudo confirmar la invalidación de los accesos. Reintenta con el servidor local disponible.';}finally{$('confirm-reset').disabled=false;}});
$('proceed-group').addEventListener('click',async()=>{if(await window.participantGate.verifyReady())showScreen('choose');});
renderPlaces();renderShots();
