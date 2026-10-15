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
        const progress=Math.floor(clampPercent(percent));
        if(api.state.uploading&&api.state.progress===progress&&api.state.message===message)return;
        api.set({uploading:true,progress,error:"",success:"",message,showTrack:true});
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

  async function uploadChunkedFile({url,file,chunkSize,buildBody,retryDelays=[],onProgress=()=>{},requestOptions={},concurrency=1}){
    if(!Number.isSafeInteger(chunkSize)||chunkSize<1||!Number.isSafeInteger(file?.size)||file.size<1)throw new Error("Choose a non-empty file and a valid chunk size.");
    if(!Number.isInteger(concurrency)||concurrency<1||concurrency>3)throw new Error("Upload concurrency must be between 1 and 3.");
    const chunkCount=Math.ceil(file.size/chunkSize);
    const transferred=new Array(chunkCount).fill(0);
    const confirmed=new Set();
    let nextIndex=0;
    let failure;
    function report(chunkIndex){
      if(failure)return;
      const bytes=transferred.reduce((total,value)=>total+value,0);
      const percent=confirmed.size===chunkCount?100:Math.min(99,bytes/file.size*100);
      onProgress(clampPercent(percent),{chunkIndex,chunkCount});
    }
    async function worker(){
      while(!failure&&nextIndex<chunkCount){
        const chunkIndex=nextIndex++;
        const start=chunkIndex*chunkSize;
        const end=Math.min(file.size,start+chunkSize);
        try{
          const body=buildBody({chunkIndex,chunkCount,start,end});
          const response=await sendFormDataWithRetry(url,body,{
            ...requestOptions,
            retryDelays,
            onProgress(ratio){
              transferred[chunkIndex]=Math.max(transferred[chunkIndex],Math.max(0,Math.min(1,ratio))*(end-start));
              report(chunkIndex);
            }
          });
          if(!response.ok)throw new Error(response.data?.message||"The upload stopped early.");
          transferred[chunkIndex]=end-start;
          confirmed.add(chunkIndex);
          report(chunkIndex);
        }catch(error){
          failure=error;
        }
      }
    }
    // Opt in only for numbered-part endpoints; range-based resumable streams stay sequential.
    await Promise.all(Array.from({length:Math.min(concurrency,chunkCount)},()=>worker()));
    if(failure)throw failure;
    return {chunkCount};
  }

  window.HaloUploadProgress={createUploadUi,sendFormData,sendFormDataWithRetry,uploadChunkedFile};
})();
