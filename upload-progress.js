(function(){
  function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

  function parseBody(text){
    if(!text)return {};
    try{return JSON.parse(text);}catch{return {};}
  }

  function clampPercent(value){
    return Math.max(0,Math.min(100,Number(value)||0));
  }

  function requireElement(name,element){
    if(element)return element;
    console.warn(`[HaloUploadProgress] Missing UI element: ${name}`);
    return null;
  }

  function updateUi(ui,state){
    if(!ui)return;
    if(ui.panel){
      ui.panel.classList.toggle(ui.busyClass,state.uploading);
      ui.panel.setAttribute("aria-busy",state.uploading?"true":"false");
      ui.panel.dataset.uploadState=state.error?"error":state.success?"success":state.uploading?"uploading":"idle";
    }
    if(ui.track){
      ui.track.hidden=!state.showTrack;
      ui.track.setAttribute("aria-hidden",state.showTrack?"false":"true");
    }
    if(ui.fill){
      const progress=clampPercent(state.progress);
      const visualProgress=state.uploading&&progress===0?3:progress;
      ui.fill.style.width=`${visualProgress}%`;
    }
    if(ui.status&&state.message){
      ui.status.textContent=state.message;
    }
  }

  function createUploadUi(options){
    const ui={
      panel:requireElement("panel",options?.panel||null),
      status:requireElement("status",options?.status||null),
      track:requireElement("track",options?.track||null),
      fill:requireElement("fill",options?.fill||null),
      busyClass:options?.busyClass||"is-uploading"
    };
    const idleMessage=options?.idleMessage||"";
    const api={
      state:{uploading:false,progress:0,error:"",success:"",message:idleMessage,showTrack:Boolean(options?.showTrackWhenIdle)},
      set(next){
        api.state={...api.state,...next};
        updateUi(ui,api.state);
      },
      start(message="Preparing upload…"){
        api.set({uploading:true,progress:0,error:"",success:"",message,showTrack:true});
      },
      progress(percent,message=api.state.message){
        api.set({uploading:true,progress:percent,error:"",success:"",message,showTrack:true});
      },
      success(message,keepTrackVisible=false){
        api.set({uploading:false,progress:100,error:"",success:message||"",message:message||api.state.message,showTrack:keepTrackVisible});
      },
      fail(message){
        api.set({uploading:false,error:message||"Upload failed",success:"",message:message||"Upload failed",showTrack:true});
      },
      idle(message=idleMessage){
        api.set({uploading:false,progress:0,error:"",success:"",message,showTrack:Boolean(options?.showTrackWhenIdle)});
      }
    };
    updateUi(ui,api.state);
    return api;
  }

  // Statuses worth retrying: the request may succeed unchanged once the service recovers.
  const RETRYABLE_STATUSES=new Set([408,425,429,500,502,503,504]);

  function retryableError(message,extra={}){
    return Object.assign(new Error(message),{retryable:true,...extra});
  }

  function isRetryableUploadError(error){
    if(!error)return false;
    if(typeof error.retryable==="boolean")return error.retryable;
    return RETRYABLE_STATUSES.has(Number(error.status));
  }

  function isOffline(){
    return typeof navigator!=="undefined"&&navigator.onLine===false;
  }

  // Graceful degradation: if the browser reports it is offline, wait (bounded) for the connection
  // to return instead of burning retries against a dead network.
  function waitForOnline(maxWaitMs){
    if(!isOffline()||typeof window==="undefined"||!window.addEventListener)return Promise.resolve();
    return new Promise(resolve=>{
      const done=()=>{clearTimeout(timer);window.removeEventListener("online",done);resolve();};
      const timer=setTimeout(done,maxWaitMs);
      window.addEventListener("online",done);
    });
  }

  function sendFormData(url,body,{method="POST",headers={},credentials="same-origin",onProgress=()=>{},timeoutMs=120000}={}){
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open(method,url,true);
      xhr.timeout=timeoutMs;
      if(credentials==="include")xhr.withCredentials=true;
      if(credentials==="omit")xhr.withCredentials=false;
      Object.entries(headers).forEach(([key,value])=>{if(value!=null)xhr.setRequestHeader(key,String(value));});
      xhr.upload.onprogress=event=>{
        if(event.lengthComputable&&event.total>0)onProgress(event.loaded/event.total,event);
      };
      xhr.onerror=()=>reject(retryableError("The upload connection stopped. Please try again.",{name:"NetworkError"}));
      xhr.ontimeout=()=>reject(retryableError("The upload took too long to finish. Please try again.",{name:"TimeoutError"}));
      xhr.onload=()=>{
        const data=parseBody(xhr.responseText);
        resolve({ok:xhr.status>=200&&xhr.status<300,status:xhr.status,data});
      };
      xhr.send(body);
    });
  }

  // Retries network drops and timeouts. Retrying on HTTP status (408/429/5xx) is opt-in through
  // `retryOnStatus` because it is only safe for idempotent requests such as numbered chunk writes.
  async function sendFormDataWithRetry(url,body,{retryDelays=[],retryOnStatus=false,onRetry=()=>{},...options}={}){
    let lastError;
    for(let attempt=0;attempt<=retryDelays.length;attempt+=1){
      const canRetry=attempt<retryDelays.length;
      try{
        const response=await sendFormData(url,body,options);
        if(response.ok||!retryOnStatus||!canRetry||!RETRYABLE_STATUSES.has(response.status))return response;
        lastError=retryableError(response.data?.message||`The upload service is busy (HTTP ${response.status}).`,{status:response.status});
      }catch(error){
        lastError=error;
        if(!canRetry)break;
      }
      const delayMs=Math.round(retryDelays[attempt]*(0.75+Math.random()*0.5));
      onRetry({attempt:attempt+1,retries:retryDelays.length,delayMs,error:lastError,offline:isOffline()});
      await wait(delayMs);
      await waitForOnline(30000);
    }
    throw lastError||new Error("The upload connection stopped. Please try again.");
  }

  // Chunk writes are idempotent (each part is stored under uploadId + index), so transient failures
  // are retried by default and a retried part simply overwrites the earlier attempt.
  const DEFAULT_CHUNK_RETRY_DELAYS=[800,2000,4000];

  async function uploadChunkedFile({url,file,chunkSize,buildBody,retryDelays=DEFAULT_CHUNK_RETRY_DELAYS,onProgress=()=>{},onRetry=()=>{},requestOptions={}}){
    const chunkCount=Math.ceil(file.size/chunkSize);
    for(let chunkIndex=0;chunkIndex<chunkCount;chunkIndex+=1){
      const start=chunkIndex*chunkSize;
      const end=Math.min(file.size,start+chunkSize);
      const body=buildBody({chunkIndex,chunkCount,start,end});
      const response=await sendFormDataWithRetry(url,body,{
        ...requestOptions,
        retryDelays,
        retryOnStatus:true,
        onRetry(info){onRetry({...info,chunkIndex,chunkCount});},
        onProgress(ratio){
          const overall=((chunkIndex+ratio)/chunkCount)*100;
          onProgress(clampPercent(overall),{chunkIndex,chunkCount});
        }
      });
      if(!response.ok)throw Object.assign(new Error(response.data?.message||"The upload stopped early."),{status:response.status,retryable:RETRYABLE_STATUSES.has(response.status)});
      onProgress(clampPercent(((chunkIndex+1)/chunkCount)*100),{chunkIndex,chunkCount});
    }
    return {chunkCount};
  }

  // Sequential failover: the fallback only runs after the primary has actually failed with a
  // transient error. A healthy primary is never raced against the backup.
  async function runWithFailover({primary,fallback,shouldFailover=isRetryableUploadError,onFailover=()=>{}}){
    try{
      return {value:await primary(),path:"primary",failedOver:false};
    }catch(primaryError){
      if(!fallback||!shouldFailover(primaryError))throw primaryError;
      onFailover(primaryError);
      try{
        return {value:await fallback(primaryError),path:"fallback",failedOver:true,primaryError};
      }catch(fallbackError){
        if(fallbackError&&typeof fallbackError==="object")fallbackError.primaryError=primaryError;
        throw fallbackError;
      }
    }
  }

  async function retryTransient(work,{retryDelays=[1000,3000],onRetry=()=>{}}={}){
    for(let attempt=0;;attempt+=1){
      try{
        return await work(attempt);
      }catch(error){
        if(attempt>=retryDelays.length||!isRetryableUploadError(error))throw error;
        onRetry({attempt:attempt+1,retries:retryDelays.length,delayMs:retryDelays[attempt],error});
        await wait(retryDelays[attempt]);
        await waitForOnline(30000);
      }
    }
  }

  window.HaloUploadProgress={createUploadUi,sendFormData,sendFormDataWithRetry,uploadChunkedFile,runWithFailover,retryTransient,isRetryableUploadError};
})();
