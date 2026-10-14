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
      xhr.onerror=()=>reject(new Error("The upload connection stopped. Please try again."));
      xhr.ontimeout=()=>reject(new Error("The upload took too long to finish. Please try again."));
      xhr.onload=()=>{
        const data=parseBody(xhr.responseText);
        resolve({ok:xhr.status>=200&&xhr.status<300,status:xhr.status,data});
      };
      xhr.send(body);
    });
  }

  async function sendFormDataWithRetry(url,body,{retryDelays=[],...options}={}){
    let lastError;
    for(let attempt=0;attempt<=retryDelays.length;attempt+=1){
      try{
        return await sendFormData(url,body,options);
      }catch(error){
        lastError=error;
        if(attempt<retryDelays.length)await wait(retryDelays[attempt]);
      }
    }
    throw lastError||new Error("The upload connection stopped. Please try again.");
  }

  async function uploadChunkedFile({url,file,chunkSize,buildBody,retryDelays=[],onProgress=()=>{},requestOptions={}}){
    const chunkCount=Math.ceil(file.size/chunkSize);
    for(let chunkIndex=0;chunkIndex<chunkCount;chunkIndex+=1){
      const start=chunkIndex*chunkSize;
      const end=Math.min(file.size,start+chunkSize);
      const body=buildBody({chunkIndex,chunkCount,start,end});
      const response=await sendFormDataWithRetry(url,body,{
        ...requestOptions,
        retryDelays,
        onProgress(ratio){
          const overall=((chunkIndex+ratio)/chunkCount)*100;
          onProgress(clampPercent(overall),{chunkIndex,chunkCount});
        }
      });
      if(!response.ok)throw new Error(response.data?.message||"The upload stopped early.");
      onProgress(clampPercent(((chunkIndex+1)/chunkCount)*100),{chunkIndex,chunkCount});
    }
    return {chunkCount};
  }

  const hex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
  async function fileSha256(file){
    return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer())));
  }

  async function fileUploadId(file,scope,chunkSize=4*1024*1024){
    const digest=await fileSha256(file);
    return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify([scope,file.size,chunkSize,digest])))));
  }

  async function uploadResumableAudio({
    url="/api/song-catalog/audio",file,songId,versionId,contentType=file?.type,
    durationSeconds=0,chunkSize=4*1024*1024,onProgress=()=>{},requestOptions={},maxRetries=3
  }){
    if(!file)throw new Error("Reselect the same audio file to resume after a page reload.");
    if(!Number.isSafeInteger(file.size)||file.size<1||file.size>128*1024*1024||
      !Number.isSafeInteger(chunkSize)||chunkSize<1||chunkSize>4*1024*1024||Math.ceil(file.size/chunkSize)>32||
      !songId||!versionId)throw new Error("The audio file or upload target is invalid.");
    const retryLimit=Math.min(8,Math.max(0,Number.isSafeInteger(maxRetries)?maxRetries:3));
    const chunkCount=Math.ceil(file.size/chunkSize);
    const uploadId=await fileUploadId(file,[url,songId,versionId,contentType],chunkSize);
    const details={songId,versionId,uploadId,chunkCount,chunkSize,byteSize:file.size,filename:file.name,contentType};
    const cacheKey=`halo-audio-resume:${uploadId}`;
    function cache(status){
      try{
        if(status.finalized)window.localStorage.removeItem(cacheKey);
        else window.localStorage.setItem(cacheKey,JSON.stringify({...details,confirmedBytes:status.confirmedBytes||0,reselectRequired:true}));
      }catch{}
    }
    const retryable=status=>status===408||status===429||(status>=500&&status<600);
    const pause=attempt=>wait(Math.min(10000,500*2**attempt)*(0.75+Math.random()*0.5));
    async function request(body){
      let response;
      const controller=new AbortController();
      const timeoutMs=Number.isFinite(requestOptions.timeoutMs)&&requestOptions.timeoutMs>0?Math.min(300000,requestOptions.timeoutMs):120000;
      let timer;
      const deadline=new Promise((resolve,reject)=>{
        timer=setTimeout(()=>{
          reject(Object.assign(new Error("The upload request timed out. Reselect the same file to resume."),{
            status:response?.status,retryable:response&&!response.ok?retryable(response.status):true
          }));
          controller.abort();
        },timeoutMs);
      });
      async function perform(){
        try{
          response=await fetch(url,{
            method:"POST",credentials:requestOptions.credentials||"same-origin",signal:controller.signal,
            headers:body instanceof FormData?{...requestOptions.headers}:{"Content-Type":"application/json",...requestOptions.headers},
            body:body instanceof FormData?body:JSON.stringify(body)
          });
        }catch(error){
          throw Object.assign(new Error("The upload connection stopped. Reselect the same file to resume."),{retryable:error.name==="TypeError"||error.name==="NetworkError",cause:error});
        }
        let data;
        try{data=await response.json();}catch(error){
          if(!response.ok)throw Object.assign(new Error(`Audio upload failed (HTTP ${response.status}).`),{status:response.status,retryable:retryable(response.status)});
          throw Object.assign(new Error("The audio response could not be read. Reselect the same file to resume."),{retryable:true,ambiguous:true,cause:error});
        }
        if(!response.ok)throw Object.assign(new Error(data?.message||`Audio upload failed (HTTP ${response.status}).`),{
          status:response.status,retryable:retryable(response.status),finalized:data?.finalized===true
        });
        return data;
      }
      try{return await Promise.race([perform(),deadline]);}finally{clearTimeout(timer);}
    }
    async function getStatus(){
      for(let attempt=0;;attempt++){
        try{
          const status=await request({action:"upload_status",...details});
          if(typeof status.finalized!=="boolean"||!Array.isArray(status.receivedChunks)||!status.chunkChecksums||
            status.receivedChunks.some(index=>!Number.isSafeInteger(index)||index<0||index>=chunkCount)||
            !Number.isSafeInteger(status.confirmedBytes)||status.confirmedBytes<0||status.confirmedBytes>file.size)
            throw new Error("The server returned an invalid upload status. No audio was sent.");
          cache(status);
          onProgress(clampPercent((status.confirmedBytes||0)/file.size*100),{...status,uploadId,chunkCount});
          return status;
        }catch(error){
          if(!error.retryable||attempt>=retryLimit)throw error;
          await pause(attempt);
        }
      }
    }
    const checksums={};
    function matches(status,index){
      if(!status.receivedChunks.includes(index))return false;
      if(status.chunkChecksums[index]!==checksums[index])
        throw new Error("Saved audio conflicts with the selected file. Choose the original file or a new version.");
      return true;
    }
    const result=(status,alreadyFinalized=true)=>{
      if(status.finalized===true){
        status={
          ...status,persisted:true,lockedIn:true,
          audioUrl:status.audioUrl||`${url}${url.includes("?")?"&":"?"}versionId=${encodeURIComponent(versionId)}`,
          message:status.message||"Audio is persisted and locked into HALO storage."
        };
      }
      if(status.persisted!==true||status.lockedIn!==true||!status.audioUrl)
        throw new Error("The server did not confirm audio persistence. Reselect the same file to resume.");
      cache({finalized:true});
      onProgress(100,{...status,uploadId,chunkCount,finalized:true});
      return {...status,...details,alreadyFinalized};
    };
    cache({confirmedBytes:0});
    for(let chunkIndex=0;chunkIndex<chunkCount;chunkIndex++){
      const chunk=file.slice(chunkIndex*chunkSize,Math.min(file.size,(chunkIndex+1)*chunkSize),contentType);
      checksums[chunkIndex]=hex(new Uint8Array(await crypto.subtle.digest("SHA-256",await chunk.arrayBuffer())));
      for(let attempt=0;;attempt++){
        const status=await getStatus();
        if(status.finalized)return result(status);
        if(matches(status,chunkIndex))break;
        const form=new FormData();
        Object.entries({...details,chunkIndex,offset:chunkIndex*chunkSize,chunkSha256:checksums[chunkIndex]}).forEach(([key,value])=>form.append(key,String(value)));
        form.append("chunk",chunk,file.name);
        try{
          await request(form);
        }catch(error){
          const finalizedHint=error.status===409&&error.finalized===true;
          if(!error.retryable&&!error.ambiguous&&!finalizedHint)throw error;
          const reconciled=await getStatus();
          if(reconciled.finalized)return result(reconciled);
          if(finalizedHint)throw error;
          if(matches(reconciled,chunkIndex))break;
          if(!error.retryable||attempt>=retryLimit)throw error;
          await pause(attempt);
          continue;
        }
        const confirmed=await getStatus();
        if(confirmed.finalized)return result(confirmed);
        if(!matches(confirmed,chunkIndex))throw new Error("The server did not confirm this audio chunk. Reselect the same file to resume.");
        break;
      }
    }
    for(let attempt=0;;attempt++){
      const status=await getStatus();
      if(status.finalized)return result(status);
      for(let index=0;index<chunkCount;index++){
        if(!matches(status,index))throw new Error("The audio upload is incomplete. Reselect the same file to resume.");
      }
      try{
        const finalized=await request({action:"finalize_upload",...details,durationSeconds});
        return result(finalized,Boolean(finalized.alreadyFinalized));
      }catch(error){
        const finalizedHint=error.status===409&&error.finalized===true;
        if(!error.retryable&&!error.ambiguous&&!finalizedHint)throw error;
        const reconciled=await getStatus();
        if(reconciled.finalized)return result(reconciled);
        if(!error.retryable||attempt>=retryLimit)throw error;
        await pause(attempt);
      }
    }
  }

  window.HaloUploadProgress={createUploadUi,sendFormData,sendFormDataWithRetry,uploadChunkedFile,fileSha256,fileUploadId,uploadResumableAudio};
})();
