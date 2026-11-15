'use strict';
(() => {
  let token=location.hash.slice(1);
  history.replaceState(null,'',location.pathname);
  const status=document.getElementById('claim-status');
  const metadata=document.getElementById('claim-metadata');
  let claimGeneration=0;
  async function claim(){
    const requestId=++claimGeneration;
    const requestToken=token;
    status.textContent='Comprobando el acceso local…';
    metadata.hidden=true;document.getElementById('recheck').disabled=true;document.getElementById('recheck').hidden=true;
    if(!requestToken){status.textContent='Falta el acceso. Vuelve a abrir el enlace original de esta demo.';return;}
    if(location.origin!=='http://127.0.0.1:5608'){status.textContent='Abre este acceso desde el servidor local de la demostración.';return;}
    try{
      const response=await fetch('/api/demo/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:requestToken}),cache:'no-store',referrerPolicy:'no-referrer'});
      if(requestId!==claimGeneration)return;
      const result=await response.json();
      if(requestId!==claimGeneration)return;
      if(!response.ok){status.textContent='Este acceso ya no está disponible. Puede haber vencido o sido invalidado.';return;}
      status.textContent='Acceso de ejemplo válido. Consulta de estado, sin derecho de descarga.';
      metadata.hidden=false;
      const participant=result.participantId||result.participant?.id||'individual';
      const guardian=result.control==='guardian'||result.participant?.kind==='minor'||result.participant?.kind==='uncertain';
      metadata.textContent=`Persona de ejemplo: ${participant}. ${guardian?'Acceso reservado para la persona responsable. No verifica identidad ni tutela.':'Acceso individual de demostración.'} Pago: no procesado. Entrega de fotografías: no habilitada.`;
      document.getElementById('recheck').hidden=false;
    }catch{if(requestId!==claimGeneration)return;status.textContent='No se pudo consultar el servidor local. Mantén abierta la demostración y reintenta.';document.getElementById('recheck').hidden=false;}
    finally{if(requestId===claimGeneration)document.getElementById('recheck').disabled=false;}
  }
  window.addEventListener('hashchange',()=>{token=location.hash.slice(1);history.replaceState(null,'',location.pathname);claim();});
  document.getElementById('recheck').addEventListener('click',claim);claim();
})();
