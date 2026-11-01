/* Trạm chuyển tiếp cho OBS (Cloudflare Worker + Durable Objects).
   Một mã phòng + một mã PIN dùng chung cho cả kiểm phiếu và overlay người chơi.
   1) Kiểm phiếu (từ web quản trò):
      POST /api/room/<MÃ>          web quản trò gửi kết quả vote (kèm mã PIN ở x-key)
      GET  /api/room/<MÃ>/ws       overlay kiểm phiếu nghe qua WebSocket
   2) Overlay 12 người chơi (từ trang điều khiển):
      GET  /api/stage/<PHÒNG>              toàn bộ cấu hình (tên, ảnh, chết, POV, icon vai)
      POST /api/stage/<PHÒNG>              lưu cấu hình (kèm mã PIN ở x-key)
      POST /api/stage/<PHÒNG>/avatar/<SỐ>  lưu ảnh một ghế (kèm mã PIN)
      GET  /api/stage/<PHÒNG>/ws           overlay người chơi nghe qua WebSocket
      (overlay kiểm phiếu cũng nghe kênh này để lấy thông tin ván cho khung idle: type 'game')
   Trang: /overlay (kiểm phiếu) · /overlay-nguoi-choi (12 người) · /dieu-khien (bảng điều khiển) */
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'content-type,x-key'};
const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...CORS,'content-type':'application/json'}});

export class Room {
  constructor(state){ this.state=state; }
  broadcast(obj){ const s=JSON.stringify(obj), socks=this.state.getWebSockets(); for(const ws of socks){ try{ ws.send(s); }catch(e){} } return socks.length; }
  async checkKey(req,minLen){ const key=req.headers.get('x-key')||''; if(key.length<minLen) return 'missing key';
    const k0=await this.state.storage.get('key'); if(k0&&k0!==key) return 'forbidden'; if(!k0) await this.state.storage.put('key',key); return null; }
  async full(){ const st=await this.state.storage.get('state')||null; const m=await this.state.storage.list({prefix:'av:'}); const av={};
    for(const [k,v] of m) av[k.slice(3)]=v; return {type:'full',state:st,avatars:av,summary:await this.state.storage.get('sum')||null,game:await this.state.storage.get('game')||null}; }
  async fetch(req){
    const url=new URL(req.url), stage=url.pathname.startsWith('/api/stage/');
    if(req.headers.get('Upgrade')==='websocket'){
      const pair=new WebSocketPair(), client=pair[0], server=pair[1];
      this.state.acceptWebSocket(server);
      if(stage) server.send(JSON.stringify(await this.full()));
      else server.send(JSON.stringify(await this.state.storage.get('last')||{type:'hello'}));
      return new Response(null,{status:101,webSocket:client});
    }
    if(stage){
      const sm=url.pathname.match(/\/source\/(\d{1,2})$/);
      if(sm){ if(req.method!=='GET') return json({ok:false},405); return json(await this.state.storage.get('sr:'+sm[1])||{}); } /* ảnh gốc + vị trí cắt, chỉ trang điều khiển đọc */
      if(req.method==='GET') return json(await this.full());
      if(req.method!=='POST') return json({ok:false},405);
      const err=await this.checkKey(req,4); if(err) return json({ok:false,error:err},err==='forbidden'?403:400);
      const am=url.pathname.match(/\/avatar\/(\d{1,2})$/);
      let body; try{ body=await req.json(); }catch(e){ return json({ok:false,error:'bad json'},400); }
      if(am){ const n=am[1], u=body&&body.url;
        const okImg=(x,max)=>typeof x==='string'&&/^data:image\/(webp|jpeg|png);base64,/.test(x)&&x.length<=max;
        if(u==null){ await this.state.storage.delete('av:'+n); await this.state.storage.delete('sr:'+n); }
        else { if(!okImg(u,400000)) return json({ok:false,error:'bad image'},400);
          if(body.src!==undefined&&body.src!==null&&!okImg(body.src,1500000)) return json({ok:false,error:'bad source'},400);
          await this.state.storage.put('av:'+n,u);
          if(body.src) await this.state.storage.put('sr:'+n,{src:body.src,crop:body.crop||null});
          else if(body.crop&&body.keepSrc){ const o=await this.state.storage.get('sr:'+n); if(o){ o.crop=body.crop; await this.state.storage.put('sr:'+n,o); } }
          else if(body.src===null) await this.state.storage.delete('sr:'+n); }
        return json({ok:true,viewers:this.broadcast({type:'avatar',n,url:u||null})}); }
      if(body&&body.op==='auth') return json({ok:true});
      /* web quản trò gửi riêng phần chết / Thị trưởng / tên, không đụng ảnh, POV, icon vai */
      if(body&&body.op==='patch'){
        const st=await this.state.storage.get('state')||{players:[],set:{dead:'gray',hide:0}};
        st.players=Array.from({length:12},(_,i)=>Object.assign({name:'',dead:0,pov:0,roles:[]},(st.players||[])[i]||{}));
        if(body.dead&&typeof body.dead==='object') for(const [k,v] of Object.entries(body.dead)){ const n=+k; if(n>=1&&n<=12) st.players[n-1].dead=v?1:0; }
        if(st.speak&&st.players[st.speak-1]&&st.players[st.speak-1].dead) st.speak=null; /* chết thì tắt phát biểu */
        if(Array.isArray(body.cand)) st.cand=body.cand.map(Number).filter(n=>n>=1&&n<=12).slice(0,12); /* người lên giàn tranh cử */
        if('summary' in body){ /* bảng tổng kết ván: lưu riêng, gửi riêng */
          const sm=body.summary; if(sm&&JSON.stringify(sm).length>120000) return json({ok:false,error:'summary too big'},400);
          if(sm) await this.state.storage.put('sum',sm); else { await this.state.storage.delete('sum'); st.set=Object.assign({},st.set,{sum:0}); }
          this.broadcast({type:'summary',summary:sm||null}); }
        if('game' in body){ /* thông tin ván cho khung idle của overlay kiểm phiếu: lưu riêng, chỉ gửi khi đổi */
          const g=body.game, gs=g?JSON.stringify(g):''; if(gs.length>80000) return json({ok:false,error:'game too big'},400);
          const g0=await this.state.storage.get('game'); if(gs!==(g0?JSON.stringify(g0):'')){
            if(g) await this.state.storage.put('game',g); else await this.state.storage.delete('game');
            this.broadcast({type:'game',game:g||null}); } }
        if('mayor' in body){ const m=+body.mayor; st.mayor=m>=1&&m<=12?m:null; }
        if(body.names&&typeof body.names==='object') for(const [k,v] of Object.entries(body.names)){ const n=+k; if(n>=1&&n<=12) st.players[n-1].name=String(v||'').slice(0,22); }
        st.at=Date.now(); await this.state.storage.put('state',st);
        return json({ok:true,viewers:this.broadcast({type:'state',state:st})}); }
      if(!body||!body.state||!Array.isArray(body.state.players)) return json({ok:false,error:'bad state'},400);
      body.state.at=Date.now(); await this.state.storage.put('state',body.state);
      return json({ok:true,viewers:this.broadcast({type:'state',state:body.state})});
    }
    if(req.method==='POST'){ /* mã PIN đã được kiểm ở ngoài (dùng chung PIN của phòng overlay người chơi) */
      let msg; try{ msg=await req.json(); }catch(e){ return new Response('bad json',{status:400,headers:CORS}); }
      msg.at=Date.now(); await this.state.storage.put('last',msg);
      return json({ok:true,viewers:this.broadcast(msg)});
    }
    return new Response('ok',{headers:CORS});
  }
  webSocketMessage(ws,m){ if(m==='ping') ws.send('pong'); }
  webSocketClose(ws,code){ try{ ws.close(code,'bye'); }catch(e){} }
}

export default {
  async fetch(req,env){
    const url=new URL(req.url);
    const m=url.pathname.match(/^\/api\/(room|stage)\/([A-Za-z0-9]{3,16})(\/ws|\/(?:avatar|source)\/\d{1,2})?$/);
    if(m){
      if(req.method==='OPTIONS') return new Response(null,{headers:CORS});
      const R=m[2].toUpperCase(), stageDO=env.ROOMS.get(env.ROOMS.idFromName('S:'+R));
      if(m[1]==='stage') return stageDO.fetch(req);
      /* kiểm phiếu: 1 mã phòng + 1 mã PIN chung với overlay người chơi */
      if(req.method==='POST'){ const a=await stageDO.fetch(new Request(url.origin+'/api/stage/'+R,{method:'POST',headers:{'content-type':'application/json','x-key':req.headers.get('x-key')||''},body:'{"op":"auth"}'}));
        if(!a.ok) return new Response(a.status===403?'forbidden':'missing key',{status:a.status,headers:CORS}); }
      return env.ROOMS.get(env.ROOMS.idFromName(R)).fetch(req);
    }
    return env.ASSETS.fetch(req);
  }
};
