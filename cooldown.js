/* COTI withdrawal countdown formatting. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.PrivexCooldown=api;
})(typeof window!=="undefined"?window:globalThis,function(){
  "use strict";
  function secondsRemaining(unixSeconds,nowMs=Date.now()){
    if(unixSeconds===null||unixSeconds===undefined||unixSeconds==="")return null;
    const seconds=Number(unixSeconds);
    if(!Number.isSafeInteger(seconds)||seconds<0)return null;
    if(!Number.isFinite(nowMs))return null;
    return Math.max(0,Math.ceil((seconds*1000-nowMs)/1000));
  }
  function formatRemaining(seconds){
    if(seconds===null||seconds===undefined||!Number.isFinite(seconds)||seconds<0)return "Unavailable";
    const n=Math.ceil(seconds);
    if(n<=0)return "Ready";
    const day=Math.floor(n/86400);
    const hour=Math.floor(n%86400/3600);
    const minute=Math.floor(n%3600/60);
    const second=n%60;
    const pad=v=>String(v).padStart(2,"0");
    if(day>0)return `${day}d ${pad(hour)}h ${pad(minute)}m ${pad(second)}s`;
    if(hour>0)return `${hour}h ${pad(minute)}m ${pad(second)}s`;
    return `${minute}m ${pad(second)}s`;
  }
  return Object.freeze({secondsRemaining,formatRemaining});
});