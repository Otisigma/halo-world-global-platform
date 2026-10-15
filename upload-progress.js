(function(){
  const protocolVersion=2;
  const resumeMessage="Upload paused. Reselect the same file and retry to resume saved bytes or registration.";
  const uploadApiPath=/^\/api\//;
  const revisionRequiredPath=/^\/api\/song-catalog\/(?:audio|master-upload)(?:[?\/]|$)/;
  function uploadRequestHeaders(url,headers={}){
    if(!uploadApiPath.test(String(url)))return headers;
    const build=window.HaloUploadBuild;
    if(build&&build.protocolVersion!==protocolVersion)throw protocolError();
    return {...headers,"X-Upload-Protocol":"2",...(build?.revision?{"X-Upload-Revision":build.revision}:{})};
  }
  function validateUploadRevision(data){
    const build=window.HaloUploadBuild;
    if(build&&build.protocolVersion!==protocolVersion)throw protocolError(data);
    if(build?.revision&&data?.revision!==build.revision)throw protocolError(data);
    return data;
  }
  function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
  function retryDelay(delay,error){
    const requested=Number(error?.retryAfterMs)||0;
    return Math.min(30000,Math.max(requested,Math.max(0,Number(delay)||0)*(0.75+Math.random()*0.5)));
  }
  function protocolError(status){
    return Object.assign(new Error(`Upload protocol/runtime mismatch. Refresh this page and retry.${status?.revision?` Server revision: ${status.revision}.`:""}`),{retryable:false});
  }
  function validateUploadStatus(status,required=false){
    if((required||status?.protocolVersion!=null)&&status?.protocolVersion!==protocolVersion)throw protocolError(status);
    if(status?.protocolVersion===protocolVersion&&(typeof status.generation!=="string"||!status.generation))throw protocolError(status);
    if(required||status?.protocolVersion!=null)validateUploadRevision(status);
    return status;
  }

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
      if(ui.panel.classList.contains(ui.busyClass)!==state.uploading)ui.panel.classList.toggle(ui.busyClass,state.uploading);
      const busy=state.uploading?"true":"false";
      if(ui.panel.getAttribute("aria-busy")!==busy)ui.panel.setAttribute("aria-busy",busy);
      const uploadState=state.connectionState==="paused"?"paused":state.error?"error":state.success?"success":["reconnecting","resuming"].includes(state.connectionState)?state.connectionState:state.uploading?"uploading":"idle";
      if(ui.panel.dataset.uploadState!==uploadState)ui.panel.dataset.uploadState=uploadState;
    }
    if(ui.track){
      if(ui.track.hidden!==!state.showTrack)ui.track.hidden=!state.showTrack;
      const hidden=state.showTrack?"false":"true";
      if(ui.track.getAttribute("aria-hidden")!==hidden)ui.track.setAttribute("aria-hidden",hidden);
    }
    if(ui.fill){
      const progress=clampPercent(state.progress);
      const visualProgress=state.uploading&&progress===0?3:progress;
      const width=`${visualProgress}%`;
      if(ui.fill.style.width!==width)ui.fill.style.width=width;
    }
    if(ui.status&&state.message){
      const message=String(state.message);
      if(ui.status.textContent!==message)ui.status.textContent=message;
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
        api.set({uploading:true,progress:0,error:"",success:"",connectionState:"uploading",message,showTrack:true});
      },
      progress(percent,message=api.state.message){
        api.set({uploading:true,progress:percent,error:"",success:"",message,showTrack:true});
      },
      success(message,keepTrackVisible=false){
        api.set({uploading:false,progress:100,error:"",success:message||"",connectionState:"",message:message||api.state.message,showTrack:keepTrackVisible});
      },
      fail(message){
        api.set({uploading:false,error:message||"Upload failed",success:"",connectionState:message?.includes(resumeMessage)?"paused":"",message:message||"Upload failed",showTrack:true});
      },
      transfer(percent,details={}){
        const connectionState=details.state||"uploading";
        const confirmed=clampPercent(details.confirmedPercent??percent);
        const sent=clampPercent(details.sentPercent??percent);
        api.set({uploading:connectionState!=="paused",progress:confirmed,confirmedProgress:confirmed,sentProgress:sent,connectionState,error:"",success:"",showTrack:true,
          message:connectionState==="paused"?resumeMessage:connectionState==="reconnecting"?`Reconnecting · ${Math.round(confirmed)}% confirmed. Saved bytes will resume.`:connectionState==="resuming"?`Resuming saved upload · ${Math.round(confirmed)}% confirmed`:`${Math.round(sent)}% sent · ${Math.round(confirmed)}% confirmed`});
      },
      idle(message=idleMessage){
        api.set({uploading:false,progress:0,error:"",success:"",connectionState:"",message,showTrack:Boolean(options?.showTrackWhenIdle)});
      }
    };
    updateUi(ui,api.state);
    return api;
  }

  function sendFormData(url,body,{method="POST",headers={},credentials="same-origin",onProgress=()=>{},timeoutMs=120000}={}){
    return new Promise((resolve,reject)=>{
      headers=uploadRequestHeaders(url,headers);
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
        try{if(revisionRequiredPath.test(String(url))||data?.protocolVersion!=null)validateUploadRevision(data);}
        catch(error){reject(error);return;}
        const retryAfter=xhr.getResponseHeader?.("Retry-After");
        const retryAfterMs=retryAfter?(Number.isFinite(Number(retryAfter))?Number(retryAfter)*1000:Date.parse(retryAfter)-Date.now()):0;
        resolve({ok:xhr.status>=200&&xhr.status<300,status:xhr.status,data,retryAfterMs:Math.max(0,Math.min(30000,retryAfterMs||0))});
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
          const overall=(start+ratio*(end-start))/file.size*100;
          onProgress(clampPercent(overall),{chunkIndex,chunkCount});
        }
      });
      if(!response.ok)throw new Error(response.data?.message||"The upload stopped early.");
      onProgress(clampPercent(end/file.size*100),{chunkIndex,chunkCount});
    }
    return {chunkCount};
  }

  async function fileUploadId(file,scope,chunkSize){
    const hashes=[];
    for(let start=0;start<file.size;start+=chunkSize){
      const digest=await crypto.subtle.digest("SHA-256",await file.slice(start,start+chunkSize).arrayBuffer());
      hashes.push(Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join(""));
    }
    const identity=JSON.stringify([scope,file.size,chunkSize,hashes]);
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(identity));
    return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
  }

  function requireUploadResponse(response){
    if(response.data?.protocolVersion!=null&&response.data.protocolVersion!==protocolVersion)throw protocolError(response.data);
    if(response.data?.protocolVersion!=null)validateUploadRevision(response.data);
    if(response.ok)return response.data;
    const error=new Error(response.data?.message||`The upload stopped (HTTP ${response.status}).`);
    error.retryable=response.status===0||response.status===408||response.status===409||response.status===429||response.status>=500;
    error.retryAfterMs=response.retryAfterMs;
    throw error;
  }

  async function fetchJsonWithTimeout(url,options={},timeoutMs=30000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(url,{credentials:"same-origin",...options,headers:uploadRequestHeaders(url,options.headers),signal:controller.signal});
      const data=await response.json().catch(error=>{if(error.name==="AbortError")throw error;return {};});
      const header=response.headers?.get("Retry-After");
      const retryAfterMs=header?(Number.isFinite(Number(header))?Number(header)*1000:Date.parse(header)-Date.now()):0;
      if(revisionRequiredPath.test(String(url))||data?.protocolVersion!=null)validateUploadRevision(data);
      return {ok:response.ok,status:response.status,data,retryAfterMs:Math.max(0,Math.min(30000,retryAfterMs||0))};
    }catch(error){
      if(error.name==="AbortError")throw new Error("Upload request timed out. Please retry to resume.");
      throw error;
    }finally{clearTimeout(timer);}
  }

  async function uploadResumableFile({file,chunkSize,getStatus,sendChunk,onProgress=()=>{},retryDelays=[1000,3000,5000]}){
    if(!Number.isSafeInteger(file.size)||file.size<1||!Number.isSafeInteger(chunkSize)||chunkSize<1)throw new Error("The upload file or chunk size is invalid.");
    let confirmed=0;
    let sent=0;
    let generation;
    let retries=0;
    let resets=0;
    let hasStatus=false;
    let reconnecting=false;
    const progress=(state="uploading")=>onProgress(confirmed/file.size*100,{uploadedBytes:confirmed,confirmedBytes:confirmed,sentBytes:sent,confirmedPercent:confirmed/file.size*100,sentPercent:sent/file.size*100,state,generation});
    const reconcile=status=>{
      validateUploadStatus(status);
      const offset=status.uploadedBytes;
      const reset=typeof status.generation==="string"&&generation!=null&&status.generation!==generation&&typeof status.resetReason==="string"&&Boolean(status.resetReason);
      if(!Number.isSafeInteger(offset)||offset<0||offset>file.size||(offset!==file.size&&offset%chunkSize)
        ||(status.chunkSize!=null&&status.chunkSize!==chunkSize)||(offset<confirmed&&!reset)
        ||(generation!=null&&status.generation!=null&&status.generation!==generation&&!reset)){
        throw Object.assign(new Error("The server returned an invalid upload offset or unexplained generation regression."),{retryable:false});
      }
      if(reset&&++resets>retryDelays.length+1)throw Object.assign(new Error(`Storage kept resetting the upload. ${resumeMessage}`),{retryable:false});
      if(offset>confirmed&&!reset)retries=0;
      if(reset)sent=offset;
      confirmed=offset;
      sent=Math.max(sent,confirmed);
      generation=status.generation??generation;
      progress(reconnecting||reset||(!hasStatus&&confirmed>0)?"resuming":"uploading");
      hasStatus=true;
      reconnecting=false;
      return status;
    };
    const result=status=>({chunkCount:Math.ceil(file.size/chunkSize),uploadedBytes:confirmed,generation,phase:status.phase,result:status.result});
    while(true){
      try{
        // Reconcile before every send, including retries after a lost response.
        const status=reconcile(await getStatus());
        if(confirmed===file.size)return result(status);
        const end=Math.min(file.size,confirmed+chunkSize);
        const sendingGeneration=generation;
        await sendChunk(file.slice(confirmed,end),confirmed,end,ratio=>{sent=Math.max(confirmed,confirmed+clampPercent(ratio*100)/100*(end-confirmed));progress();});
        sent=end;
        const next=reconcile(await getStatus());
        if(generation!==sendingGeneration)continue;
        if(confirmed<end)throw new Error("The server has not yet confirmed the uploaded chunk.");
        if(confirmed===file.size)return result(next);
      }catch(error){
        if(error.retryable===false){progress("paused");throw error;}
        if(retries>=retryDelays.length){progress("paused");throw Object.assign(new Error(`${error.message} ${resumeMessage}`),{retryable:true});}
        progress("reconnecting");
        reconnecting=true;
        await wait(retryDelay(retryDelays[retries++],error));
      }
    }
  }

  async function completeResumableUpload({getStatus,complete,resume,byteSize,generation,onProgress=()=>{},retryDelays=[1000,3000,5000]}){
    const terminalPhases=["complete","completed","registered","finalized","review_pending"];
    const persistedResult=status=>terminalPhases.includes(status.phase)&&status.result&&(status.protocolVersion==null||status.result.persisted===true);
    let activeGeneration=generation;
    let resetGeneration;
    let renewals=0;
    for(let attempt=0;;attempt++){
      let completing=false;
      try{
        const status=validateUploadStatus(await getStatus());
        if(byteSize!=null&&(!Number.isSafeInteger(status.uploadedBytes)||status.uploadedBytes<0||status.uploadedBytes>byteSize))throw Object.assign(new Error("The server returned an invalid registration offset."),{retryable:false});
        if(persistedResult(status))return status.result;
        if(terminalPhases.includes(status.phase))throw protocolError(status);
        if(byteSize!=null&&status.uploadedBytes<byteSize){
          const continuingReset=typeof resetGeneration==="string"&&Boolean(resetGeneration)&&resetGeneration===status.generation;
          if(!continuingReset&&(!status.generation||!activeGeneration||status.generation===activeGeneration||typeof status.resetReason!=="string"||!status.resetReason)){
            throw Object.assign(new Error("The server returned an unexplained upload regression during registration."),{retryable:false});
          }
          if(typeof resume!=="function"||(!continuingReset&&++renewals>retryDelays.length+1))throw Object.assign(new Error(resumeMessage),{retryable:false});
          resetGeneration=status.generation;
          activeGeneration=status.generation;
          onProgress(status.uploadedBytes/byteSize*100,{state:"resuming",confirmedPercent:status.uploadedBytes/byteSize*100,sentPercent:status.uploadedBytes/byteSize*100});
          const resumed=await resume();
          if(resumed.uploadedBytes!==byteSize)throw new Error("The renewed upload has not yet been confirmed.");
          activeGeneration=resumed.generation||status.generation;
          resetGeneration=null;
          continue;
        }
        activeGeneration=status.generation||activeGeneration;
        if(["finalizing","registering"].includes(status.phase))throw new Error("Registration is still processing.");
        // The server's completing checkpoint is durable recovery state, not a lock.
        completing=true;
        const completed=await complete();
        if(completed?.protocolVersion!=null){
          if(completed.protocolVersion!==protocolVersion||completed.persisted!==true)throw protocolError(completed);
          validateUploadRevision(completed);
        }
        return completed;
      }catch(error){
        if(error.retryable===false)throw error;
        if(attempt>=retryDelays.length){
          // Even the last request may have succeeded after its acknowledgement was lost.
          if(completing){
            try{
              const status=validateUploadStatus(await getStatus());
              if(persistedResult(status))return status.result;
            }catch(reconciliationError){if(reconciliationError.retryable===false)throw reconciliationError;}
          }
          onProgress(100,{state:"paused",confirmedPercent:100,sentPercent:100});
          throw new Error(`${error.message} ${resumeMessage}`);
        }
        onProgress(100,{state:"reconnecting",confirmedPercent:100,sentPercent:100});
        await wait(retryDelay(retryDelays[attempt],error));
      }
    }
  }

  async function getAudioUploadStatus({url="/api/song-catalog/audio",file,songId,versionId,uploadId,contentType}){
    const chunkSize=4*1024*1024;
    const query=new URLSearchParams({uploadStatus:"1",songId,versionId,uploadId,byteSize:String(file.size),chunkSize:String(chunkSize),filename:file.name,contentType});
    return validateUploadStatus(requireUploadResponse(await fetchJsonWithTimeout(`${url}?${query}`,{headers:{"X-Upload-Status":"1","X-Upload-Protocol":"2"}})),true);
  }

  async function uploadResumableAudio({url="/api/song-catalog/audio",file,songId,versionId,contentType,onProgress,retryDelays}){
    const chunkSize=4*1024*1024;
    const uploadId=await fileUploadId(file,[url,songId,versionId,contentType],chunkSize);
    const result=await uploadResumableFile({
      file,chunkSize,onProgress,retryDelays,
      async getStatus(){return getAudioUploadStatus({url,file,songId,versionId,uploadId,contentType});},
      async sendChunk(chunk,start,end,onSent){
        requireUploadResponse(await sendFormData(url,chunk,{timeoutMs:600000,onProgress:onSent,headers:{"Content-Type":"application/octet-stream","X-Upload-Protocol":"2","X-SongId":songId,"X-VersionId":versionId,"X-UploadId":uploadId,"X-Start-Byte":String(start)}}));
      }
    });
    return{...result,uploadId};
  }

  window.HaloUploadProgress={protocolVersion,createUploadUi,sendFormData,sendFormDataWithRetry,uploadChunkedFile,fileUploadId,uploadResumableFile,uploadResumableAudio,requireUploadResponse,validateUploadStatus,validateUploadRevision,uploadRequestHeaders,fetchJsonWithTimeout,getAudioUploadStatus,completeResumableUpload};
})();
