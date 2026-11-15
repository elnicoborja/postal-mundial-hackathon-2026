'use strict';
(() => {
  const el=id=>document.getElementById(id);
  const gate={batch:null,links:[],busy:false};
  const types={adult:'Adulto',minor:'Menor de edad',uncertain:'Edad incierta'};
  const pending='Todas las aprobaciones pendientes';
  const errorCopy={LOCAL_ONLY:'Abre esta demo desde http://127.0.0.1:5608 con el servidor local activo.',LOOPBACK_ONLY:'Usa la dirección local de esta demostración.',ORIGIN_REQUIRED:'Abre la página desde el servidor local para realizar esta acción.',UNKNOWN_BATCH:'Este grupo ya no está disponible. Crea un grupo nuevo.',BATCH_RESET:'Este grupo se cerró. Crea un grupo nuevo.',CONSENT_REQUIRED:'Faltan aprobaciones individuales. Revisa a todas las personas antes de continuar.',BLOCKED:'El grupo todavía no tiene todas las aprobaciones.',GUARDIAN_REQUIRED:'Esta persona requiere la ruta de aprobación del responsable.',SELF_REQUIRED:'Cada persona adulta debe registrar su aprobación personal.',INVALID_ACTOR:'La aprobación debe seguir la ruta indicada para esa persona.',INVALID_CONSENT:'Revisa la decisión individual antes de enviarla.',INVALID_PARTICIPANTS:'Elige entre 1 y 6 personas de ejemplo.',INVALID_PARTICIPANT:'Revisa las categorías de las personas de ejemplo.',INVALID_INPUT:'La solicitud no tiene el formato esperado. Revisa el grupo y reintenta.',UNKNOWN_PARTICIPANT:'La persona no pertenece a este grupo.',UNKNOWN_LINK:'Este acceso no corresponde al grupo.',INVALID_LINK:'El acceso venció o fue invalidado.',DEMO_CAPACITY:'La demostración alcanzó su límite temporal. Reinicia el servidor local para empezar una nueva prueba.',JSON_REQUIRED:'No se pudo preparar la solicitud de la demostración.',INVALID_JSON:'No se pudo preparar la solicitud de la demostración.',BODY_TOO_LARGE:'La solicitud excede el límite de esta demostración.',NOT_FOUND:'La acción no está disponible en esta demostración.',REQUEST_FAILED:'No se pudo completar la acción. Reintenta con el servidor local disponible.'};
  function error(message){el('group-error').textContent=message;}
  Object.assign(errorCopy,{ACTOR_REQUIRED:'Usa la aprobación personal o la ruta del responsable indicada para esta persona.',BATCH_CHANGED:'El grupo cambió. Revisa sus aprobaciones antes de crear nuevos accesos.',ENCODING_UNSUPPORTED:'La solicitud no es compatible con esta demostración.',NO_QUERY:'Abre el acceso original de esta demostración.',METHOD_NOT_ALLOWED:'Esta acción no está disponible de esa forma.',INVALID_PATH:'La dirección de la demostración no es válida.',DEMO_ERROR:'No se confirmó la acción; revisa el estado del grupo.'});
  async function api(path,body){
    if(location.origin!=='http://127.0.0.1:5608')throw new Error('LOCAL_ONLY');
    const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',referrerPolicy:'no-referrer'});
    const payload=await response.json();if(!response.ok)throw new Error(payload.error?.code||'REQUEST_FAILED');return payload;
  }
  function ready(){return Boolean(gate.batch&&!gate.batch.reset&&gate.batch.status==='ready'&&Date.parse(gate.batch.expiresAt)>Date.now()&&gate.batch.participants.every(p=>p.consent.decision==='approved'));}
  function configure(){
    const count=Number(el('person-count').value);
    el('participant-config').innerHTML=Array.from({length:count},(_,i)=>`<label class="person-field" for="kind-p${i+1}"><span>Persona ${i+1}</span><select id="kind-p${i+1}" data-participant="p${i+1}"><option value="uncertain">Edad incierta</option><option value="adult">Adulto</option><option value="minor">Menor de edad</option></select></label>`).join('');
  }
  function render(){
    const active=Boolean(gate.batch);el('person-count').disabled=active||gate.busy;el('create-batch').hidden=active;el('create-batch').disabled=gate.busy;el('change-group').hidden=!active;el('change-group').disabled=gate.busy;
    document.querySelectorAll('[data-participant]').forEach(input=>input.disabled=active||gate.busy);
    el('proceed-group').disabled=!ready()||gate.busy;el('issue-links').disabled=!ready()||gate.busy||gate.links.length>0;
    if(!active){el('consent-list').replaceChildren();el('group-status').textContent='Sin grupo creado. Selección bloqueada.';return;}
    const refused=gate.batch.participants.some(p=>p.consent.decision==='denied');
    el('group-status').textContent=gate.batch.reset?'Grupo cerrado. Los accesos anteriores se invalidaron.':refused?'Una persona no autoriza. Todo el grupo está bloqueado.':ready()?'Grupo aprobado en la demo. Selección habilitada.':`${gate.batch.participants.filter(p=>p.consent.decision==='approved').length} de ${gate.batch.participants.length} aprobaciones. Selección bloqueada.`;
    el('consent-list').innerHTML=gate.batch.participants.map((p,i)=>{
      const guardian=p.kind!=='adult';const decision=p.consent.decision;
      const label=decision==='approved'?'Aprobación de ejemplo registrada':decision==='denied'?'Negativa registrada':'Pendiente';
      return `<article class="person-consent"><p class="eyebrow">Persona ${i+1} · ${types[p.kind]}</p><h3>${guardian?'Ruta del responsable':'Aprobación personal'}</h3><p>${guardian?'La persona responsable revisa y autoriza en este ejemplo.':'Cada adulto revisa y autoriza su propia participación en este ejemplo.'}</p>${guardian?'<p class="guardian-warning">No verifica identidad ni tutela</p>':''}<p class="decision-label">${label}</p><div class="consent-actions"><button data-decision="approved" data-person="${p.id}" ${gate.busy||decision==='approved'||refused?'disabled':''}>${guardian?'Simular aprobación del responsable':'Simular aprobación personal'}</button><button data-decision="denied" data-person="${p.id}" ${gate.busy||decision==='denied'?'disabled':''}>Registrar negativa</button></div></article>`;
    }).join('');
  }
  async function action(work){if(gate.busy)return;gate.busy=true;error('');render();try{await work();}catch(e){error(errorCopy[e.message]||'No se confirmó la acción; revisa el estado del grupo.');}finally{gate.busy=false;render();}}
  async function clearBatch(){
    if(gate.batch){try{await api(`/api/demo/batches/${encodeURIComponent(gate.batch.batchId)}/reset`,{});}catch(e){if(e.message!=='UNKNOWN_BATCH')throw e;}}
    gate.batch=null;gate.links=[];el('recipient-links').replaceChildren();el('person-count').value='1';configure();render();error('');
  }
  function renderLinks(){
    el('recipient-links').replaceChildren();
    for(const link of gate.links){
      const p=gate.batch.participants.find(person=>person.id===link.participantId);
      const card=document.createElement('article');card.className='recipient-card';
      const title=document.createElement('h3');title.textContent=`Acceso de ${link.participantId.replace('p','persona ')}`;
      const note=document.createElement('p');note.textContent=p.kind==='adult'?'Para la propia persona adulta.':'Solo para la persona responsable. No verifica identidad ni tutela';
      const image=document.createElement('img');image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(link.qrSvg)}`;image.alt=`QR de estado de ${link.participantId}, demostración en la misma computadora`;image.width=180;image.height=180;
      const open=document.createElement('a');open.href=link.url;open.target='_blank';open.rel='noopener noreferrer';open.className='recipient-open';open.textContent='Abrir estado en esta computadora';
      const expiry=document.createElement('p');expiry.className='small';expiry.textContent=`Vence: ${new Date(link.expiresAt).toLocaleTimeString('es-MX')}. Quien tenga el enlace puede consultar su estado de ejemplo.`;
      const revoke=document.createElement('button');revoke.textContent='Invalidar este acceso';revoke.addEventListener('click',()=>action(async()=>{await api(`/api/demo/batches/${encodeURIComponent(gate.batch.batchId)}/links/${encodeURIComponent(link.linkId)}/revoke`,{});image.remove();open.remove();expiry.textContent='Acceso invalidado. Ya no permite consultar el estado.';revoke.disabled=true;revoke.textContent='Acceso invalidado';}));
      card.append(title,note,image,open,expiry,revoke);el('recipient-links').append(card);
    }
  }
  el('person-count').addEventListener('change',configure);
  el('create-batch').addEventListener('click',()=>action(async()=>{const participants=[...document.querySelectorAll('[data-participant]')].map(input=>({id:input.dataset.participant,kind:input.value}));gate.batch=await api('/api/demo/batches',{participants});el('group-status').textContent=pending;}));
  el('change-group').addEventListener('click',()=>action(clearBatch));
  el('consent-list').addEventListener('click',event=>{const button=event.target.closest('[data-decision]');if(!button)return;action(async()=>{const p=gate.batch.participants.find(person=>person.id===button.dataset.person);gate.batch=await api(`/api/demo/batches/${encodeURIComponent(gate.batch.batchId)}/consents`,{participantId:p.id,decision:button.dataset.decision,actor:p.kind==='adult'?'self':'guardian',purpose:'private-delivery'});gate.links=[];el('recipient-links').replaceChildren();});});
  el('issue-links').addEventListener('click',()=>action(async()=>{gate.batch=await api(`/api/demo/batches/${encodeURIComponent(gate.batch.batchId)}`);if(!ready())throw new Error('BLOCKED');const result=await api(`/api/demo/batches/${encodeURIComponent(gate.batch.batchId)}/links`,{});gate.links=result.links;renderLinks();}));
  window.participantGate={isReady:ready,reset:clearBatch,verifyReady:async()=>{if(!gate.batch)return false;try{gate.batch=await api(`/api/demo/batches/${encodeURIComponent(gate.batch.batchId)}`);render();return ready();}catch{error('No se pudo verificar el grupo. Reintenta antes de continuar.');return false;}}};
  configure();render();
})();
