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
      if(ui.panel.classList.contains(ui.busyClass)!==state.uploading)ui.panel.classList.toggle(ui.busyClass,state.uploading);
      const busy=state.uploading?"true":"false";
      if(ui.panel.getAttribute("aria-busy")!==busy)ui.panel.setAttribute("aria-busy",busy);
      const uploadState=state.error?"error":state.success?"success":state.uploading?"uploading":"idle";
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
    const identity=JSON.stringify([scope,file.name,file.size,chunkSize,hashes]);
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(identity));
    return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
  }

  function requireUploadResponse(response){
    if(response.ok)return response.data;
    const error=new Error(response.data?.message||`The upload stopped (HTTP ${response.status}).`);
    error.retryable=response.status===409||response.status===429||response.status>=500;
    throw error;
  }

  async function uploadResumableFile({file,chunkSize,getStatus,sendChunk,onProgress=()=>{},retryDelays=[1000,3000,5000]}){
    if(!Number.isSafeInteger(file.size)||file.size<1||!Number.isSafeInteger(chunkSize)||chunkSize<1)throw new Error("The upload file or chunk size is invalid.");
    let confirmed=0;
    let retries=0;
    while(true){
      try{
        // Reconcile before every send, including retries after a lost response.
        const status=await getStatus();
        const offset=status.uploadedBytes;
        if(!Number.isSafeInteger(offset)||offset<confirmed||offset>file.size||(offset!==file.size&&offset%chunkSize)
          ||(status.chunkSize!=null&&status.chunkSize!==chunkSize)){
          throw Object.assign(new Error("The server returned an invalid upload offset."),{retryable:false});
        }
        if(offset>confirmed)retries=0;
        confirmed=offset;
        onProgress(confirmed/file.size*100,{uploadedBytes:confirmed});
        if(confirmed===file.size)return{chunkCount:Math.ceil(file.size/chunkSize),uploadedBytes:confirmed};
        const end=Math.min(file.size,confirmed+chunkSize);
        await sendChunk(file.slice(confirmed,end),confirmed,end);
        const next=await getStatus();
        if(!Number.isSafeInteger(next.uploadedBytes)||next.uploadedBytes<end||next.uploadedBytes>file.size
          ||(next.uploadedBytes!==file.size&&next.uploadedBytes%chunkSize)){
          throw Object.assign(new Error("The server did not confirm the uploaded chunk."),{retryable:false});
        }
        confirmed=next.uploadedBytes;
        retries=0;
        onProgress(confirmed/file.size*100,{uploadedBytes:confirmed});
        if(confirmed===file.size)return{chunkCount:Math.ceil(file.size/chunkSize),uploadedBytes:confirmed};
      }catch(error){
        onProgress(confirmed/file.size*100,{uploadedBytes:confirmed});
        if(error.retryable===false||retries>=retryDelays.length)throw error;
        await wait(retryDelays[retries++]);
      }
    }
  }

  async function uploadResumableAudio({url="/api/song-catalog/audio",file,songId,versionId,contentType,onProgress,retryDelays}){
    const chunkSize=4*1024*1024;
    const uploadId=await fileUploadId(file,[url,songId,versionId,contentType],chunkSize);
    const query=new URLSearchParams({uploadStatus:"1",songId,versionId,uploadId,byteSize:String(file.size),chunkSize:String(chunkSize),filename:file.name,contentType});
    const result=await uploadResumableFile({
      file,chunkSize,onProgress,retryDelays,
      async getStatus(){return requireUploadResponse(await sendFormData(`${url}?${query}`,null,{method:"GET",headers:{"X-Upload-Status":"1"}}));},
      async sendChunk(chunk,start){
        requireUploadResponse(await sendFormData(url,chunk,{headers:{"Content-Type":"application/octet-stream","X-SongId":songId,"X-VersionId":versionId,"X-UploadId":uploadId,"X-Start-Byte":String(start)}}));
      }
    });
    return{...result,uploadId};
  }

  window.HaloUploadProgress={createUploadUi,sendFormData,sendFormDataWithRetry,uploadChunkedFile,fileUploadId,uploadResumableFile,uploadResumableAudio,requireUploadResponse};
})();
