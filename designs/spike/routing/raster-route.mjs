// 画像（標準地図）の色の付いた道（高速の緑・国道の赤・県道の黄）から道の骨格を取り出し、その上で経路を探す試し。
// 経路の元の選択設計書 §3。アプリには含めない。
// 使い方: node raster-route.mjs 緯度1 経度1 緯度2 経度2 ズーム 出力.png [回廊の幅m=800]
// 環境変数: CLOSE（切れ目をふさぐ半径、画素。既定 3）・BRIDGE_M（端点の橋渡しの距離。既定 80）・WHITE=1（白い一般道も道とみなす。地の色と同じなので失敗する）
//           SAMPLE=1（経路の点を 12 個出す）・DBG=緯度,経度（その周りの骨格を dbg.png に）・PRE=1・CLS=1（DBG の絵に細線化の前の道・高速の緑を出す）
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')
const SP = new URL('./', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
fs.mkdirSync(SP + 'cache', { recursive: true })
const [la1,ln1,la2,ln2,z]=process.argv.slice(2,7).map(Number); const out=process.argv[7]; const CW=+(process.argv[8]??800);
const wx=(lng)=>(lng+180)/360*256*2**z, wy=(lat)=>{const t=lat*Math.PI/180;return (1-Math.log(Math.tan(t)+1/Math.cos(t))/Math.PI)/2*256*2**z};
const mpp=40075016.7*Math.cos(la1*Math.PI/180)/(256*2**z); const pad=Math.ceil(CW/2/mpp);
const A=[wx(ln1),wy(la1)],B=[wx(ln2),wy(la2)];
const x0=Math.floor(Math.min(A[0],B[0])-pad),x1=Math.ceil(Math.max(A[0],B[0])+pad),y0=Math.floor(Math.min(A[1],B[1])-pad),y1=Math.ceil(Math.max(A[1],B[1])+pad);
const W=x1-x0,H=y1-y0;
// 回廊: 線分 AB からの距離 <= pad
const ax=A[0]-x0,ay=A[1]-y0,bx=B[0]-x0,by=B[1]-y0,L2=(bx-ax)**2+(by-ay)**2;
const inCor=(X,Y)=>{let t=((X-ax)*(bx-ax)+(Y-ay)*(by-ay))/L2;t=Math.max(0,Math.min(1,t));return Math.hypot(X-ax-t*(bx-ax),Y-ay-t*(by-ay))<=pad};
const get=async(url,f)=>{f=SP+'cache/'+f; if(fs.existsSync(f)) return fs.readFileSync(f); const r=await fetch(url); const b=r.status===404?Buffer.alloc(0):Buffer.from(await r.arrayBuffer()); fs.writeFileSync(f,b); return b};
const BG=0,ROAD=1,EDGE=2,IGN=3,MW=4; // MW = 高速の緑
const d2=(r,g,b,R,G,B2)=>(r-R)**2+(g-G)**2+(b-B2)**2;
function cls(r,g,b){const lum=0.2126*r+0.7152*g+0.0722*b; if(lum<=95) return IGN;
 if(b>=150&&b-Math.max(r,g)>=60&&Math.min(r,g)<150) return IGN; if(d2(r,g,b,200,160,60)<=45**2) return IGN;
 const mx=Math.max(r,g,b),mn=Math.min(r,g,b); if(mx-mn<=16&&lum<=190) return EDGE;
 if(Math.min(r,g,b)>=240) return (process.env.WHITE==='1'?ROAD:BG); if(r>=230&&g>=230&&b<=90) return ROAD; if(d2(r,g,b,255,122,122)<=35**2) return ROAD;
 if(d2(r,g,b,100,195,115)<=40**2) return MW; return BG;}
await (async()=>{
 const T0=Date.now(); let tiles=0;
 const rgb=new Uint8Array(W*H*3), C=new Uint8Array(W*H);
 for(let ty=Math.floor(y0/256);ty<=Math.floor((y1-1)/256);ty++)for(let tx=Math.floor(x0/256);tx<=Math.floor((x1-1)/256);tx++){
  // 回廊に掛からないタイルは取らない
  let hit=false; for(let j=0;j<=256&&!hit;j+=32)for(let i=0;i<=256&&!hit;i+=32) if(inCor(tx*256+i-x0,ty*256+j-y0)) hit=true; if(!hit) continue;
  const b=await get(`https://cyberjapandata.gsi.go.jp/xyz/std/${z}/${tx}/${ty}.png`,`std_${z}_${tx}_${ty}.png`); tiles++; if(!b.length) continue;
  const t=PNG.sync.read(b);
  for(let j=0;j<256;j++)for(let i=0;i<256;i++){const X=tx*256+i-x0,Y=ty*256+j-y0;if(X<0||Y<0||X>=W||Y>=H)continue;const o=(j*256+i)*4,p=Y*W+X;rgb[p*3]=t.data[o];rgb[p*3+1]=t.data[o+1];rgb[p*3+2]=t.data[o+2];C[p]=inCor(X,Y)?cls(t.data[o],t.data[o+1],t.data[o+2]):BG}
 }
 const T1=Date.now();
 // 注記の吸収: IGN の連結成分が ROAD/MW に接していれば道路とみなす（小さいものだけ）
 const M=new Uint8Array(W*H); for(let p=0;p<W*H;p++) M[p]=(C[p]===ROAD||C[p]===MW)?1:0;
 const seen=new Uint8Array(W*H);
 for(let p=0;p<W*H;p++){ if(C[p]!==IGN||seen[p]) continue; const st=[p],comp=[];seen[p]=1; let touch=0;
  while(st.length){const q=st.pop();comp.push(q);const X=q%W,Y=(q-X)/W;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=X+dx,y=Y+dy;if(x<0||y<0||x>=W||y>=H)continue;const r=y*W+x;if(C[r]===IGN&&!seen[r]){seen[r]=1;st.push(r)}else if(M[r])touch++}}
  if(comp.length<=400&&touch>=comp.length*0.3) for(const q of comp) M[q]=1; }
 // 小さな切れ目をふさぐ（closing。半径 CLOSE 画素）
 { const R=+(process.env.CLOSE??3); if(R>0){ const dil=(src,val)=>{const t=new Uint8Array(W*H),o=new Uint8Array(W*H);
   for(let y=0;y<H;y++){let run=-1e9;for(let x=0;x<W;x++){if(src[y*W+x]===val)run=x; t[y*W+x]=(x-run<=R)?1:0} run=1e9;for(let x=W-1;x>=0;x--){if(src[y*W+x]===val)run=x; if(run-x<=R)t[y*W+x]=1}}
   for(let x=0;x<W;x++){let run=-1e9;for(let y=0;y<H;y++){if(t[y*W+x])run=y; o[y*W+x]=(y-run<=R)?1:0} run=1e9;for(let y=H-1;y>=0;y--){if(t[y*W+x])run=y; if(run-y<=R)o[y*W+x]=1}}
   return o};
   const d=dil(M,1); const e=dil(d,0); for(let p=0;p<W*H;p++) M[p]=(d[p]&&!e[p])?1:0; } }
 const M0=M.slice();
 // 細線化（Zhang-Suen）
 let changed=true; const nb=(p)=>{const X=p%W;return [p-W,p-W+1,p+1,p+W+1,p+W,p+W-1,p-1,p-W-1].map(q=>M[q]?1:0)};
 for(let p=0;p<W;p++){M[p]=0;M[(H-1)*W+p]=0} for(let y=0;y<H;y++){M[y*W]=0;M[y*W+W-1]=0}
 let it=0; while(changed&&it<60){changed=false;it++; for(const step of [0,1]){const del=[]; for(let p=W;p<W*(H-1);p++){ if(!M[p]) continue; const n=nb(p); const Bn=n.reduce((a,c)=>a+c,0); if(Bn<2||Bn>6) continue; let An=0; for(let k=0;k<8;k++) if(!n[k]&&n[(k+1)%8]) An++; if(An!==1) continue;
   if(step===0){ if(n[0]*n[2]*n[4]) continue; if(n[2]*n[4]*n[6]) continue;} else { if(n[0]*n[2]*n[6]) continue; if(n[0]*n[4]*n[6]) continue;} del.push(p);} for(const p of del) M[p]=0; if(del.length) changed=true; }}
 const T2=Date.now(); let sk=0; for(let p=0;p<W*H;p++) if(M[p]) sk++;
 // 端点の橋渡し: 骨格の端点から、進む向き（cos>=0.85）の先 BR 画素以内にある別の成分の骨格へ辺を足す
 const comp=new Int32Array(W*H).fill(-1); let nc=0; const N8=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
 for(let p=0;p<W*H;p++){ if(!M[p]||comp[p]>=0) continue; const st=[p]; comp[p]=nc; while(st.length){const q=st.pop();const X=q%W,Y=(q-X)/W;for(const [dx,dy] of N8){const r=(Y+dy)*W+X+dx;if(M[r]&&comp[r]<0){comp[r]=nc;st.push(r)}}} nc++; }
 const extra=new Map(); const BR=Math.round(+(process.env.BRIDGE_M??80)/mpp); let bridges=0;
 for(let p=W;p<W*(H-1);p++){ if(!M[p]) continue; const X=p%W,Y=(p-X)/W; let deg=0; for(const [dx,dy] of N8) if(M[(Y+dy)*W+X+dx]) deg++; if(deg!==1) continue;
   // 向き: 端点から骨格を 10 画素たどった点 → 端点
   let cur=p,prv=-1; for(let k=0;k<10;k++){let nx=-1;const cx=cur%W,cy=(cur-cx)/W;for(const [dx,dy] of N8){const r=(cy+dy)*W+cx+dx;if(M[r]&&r!==prv&&r!==cur){nx=r;break}} if(nx<0)break; prv=cur;cur=nx}
   const vx=X-cur%W,vy=Y-Math.floor(cur/W),vl=Math.hypot(vx,vy); if(vl<3) continue;
   let best=-1,bs=1e9; for(let y=Math.max(1,Y-BR);y<=Math.min(H-2,Y+BR);y++)for(let x=Math.max(1,X-BR);x<=Math.min(W-2,X+BR);x++){const q=y*W+x; if(!M[q]||comp[q]===comp[p]) continue; const dx=x-X,dy=y-Y,d=Math.hypot(dx,dy); if(d>BR||d<1) continue; const c=(dx*vx+dy*vy)/(d*vl); if(c<0.85) continue; const sc=d*(2-c); if(sc<bs){bs=sc;best=q}}
   if(best>=0){ const w=Math.hypot(best%W-X,Math.floor(best/W)-Y)*1.5; for(const [a,b] of [[p,best],[best,p]]){ if(!extra.has(a)) extra.set(a,[]); extra.get(a).push([b,w]); } bridges++; } }
 // 近くの骨格の画素へ寄せる
 const snap=(X,Y)=>{let best=-1,bd=1e9;const R=Math.ceil(60/mpp);for(let y=Math.round(Y)-R;y<=Math.round(Y)+R;y++)for(let x=Math.round(X)-R;x<=Math.round(X)+R;x++){if(x<0||y<0||x>=W||y>=H)continue;const p=y*W+x;if(!M[p])continue;const d=(x-X)**2+(y-Y)**2;if(d<bd){bd=d;best=p}}return best};
 const s=snap(ax,ay),g=snap(bx,by); console.log('snap',s,g);
 // A*（8 近傍。高速の緑の上の骨格は安く: 元の画素の分類が MW なら 0.6 倍）
 const dist=new Float32Array(W*H).fill(Infinity),prev=new Int32Array(W*H).fill(-1); const gx=g%W,gy=(g-gx)/W;
 const heap=[];const push=(f,p)=>{heap.push([f,p]);let i=heap.length-1;while(i>0){const j=(i-1)>>1;if(heap[j][0]<=heap[i][0])break;[heap[i],heap[j]]=[heap[j],heap[i]];i=j}};
 const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let i=0;for(;;){let l=2*i+1,r=l+1,m=i;if(l<heap.length&&heap[l][0]<heap[m][0])m=l;if(r<heap.length&&heap[r][0]<heap[m][0])m=r;if(m===i)break;[heap[i],heap[m]]=[heap[m],heap[i]];i=m}}return top};
 dist[s]=0;push(0,s); let pops=0;
 while(heap.length){const [f,p]=pop();pops++; if(p===g)break; const X=p%W,Y=(p-X)/W; for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const x=X+dx,y=Y+dy;const q=y*W+x;if(!M[q])continue;const w=Math.hypot(dx,dy)*(C[q]===MW?0.6:1);const nd=dist[p]+w;if(nd<dist[q]){dist[q]=nd;prev[q]=p;push(nd+0.6*Math.hypot(x-gx,y-gy),q)}} const ex=extra.get(p); if(ex) for(const [q,w] of ex){const nd=dist[p]+w;if(nd<dist[q]){dist[q]=nd;prev[q]=p;const x=q%W,y=(q-x)/W;push(nd+0.6*Math.hypot(x-gx,y-gy),q)}}}
 const T3=Date.now();
 if(process.env.DBG){ const [dl,dg]=process.env.DBG.split(',').map(Number); const cx=Math.round(wx(dg)-x0),cy=Math.round(wy(dl)-y0),S=100,K=5; const im=new PNG({width:S*K,height:S*K});
   for(let y=0;y<S;y++)for(let x=0;x<S;x++){const X=cx-S/2+x,Y=cy-S/2+y;let col=[255,255,255];if(X>=0&&Y>=0&&X<W&&Y<H){const p=Y*W+X;col=[rgb[p*3],rgb[p*3+1],rgb[p*3+2]].map(v=>255-(255-v)*0.4);if(M0[p]&&process.env.PRE)col=[0,120,255];if(C[p]===4&&process.env.CLS)col=[0,200,0];if(M[p])col=isFinite(dist[p])?[230,0,0]:[0,0,0];}
     for(let a=0;a<K;a++)for(let b=0;b<K;b++){const o=((y*K+a)*S*K+x*K+b)*4;im.data[o]=col[0];im.data[o+1]=col[1];im.data[o+2]=col[2];im.data[o+3]=255}}
   fs.writeFileSync('dbg.png',PNG.sync.write(im)); }
 if(!isFinite(dist[g])){ let bp=-1,bd=1e18; for(let p=0;p<W*H;p++) if(isFinite(dist[p])){const X=p%W,Y=(p-X)/W;const d=(X-gx)**2+(Y-gy)**2;if(d<bd){bd=d;bp=p}}
   const X=bp%W+x0,Y=Math.floor(bp/W)+y0; const n=256*2**z; const lng=X/n*360-180, lat=Math.atan(Math.sinh(Math.PI*(1-2*Y/n)))*180/Math.PI; console.log('reached-closest',lat.toFixed(5),lng.toFixed(5),'remainM',Math.round(Math.sqrt(bd)*mpp)); }
 const path=[]; if(isFinite(dist[g])) for(let p=g;p!==-1;p=prev[p]) path.push(p);
 let len=0; for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i];len+=Math.hypot(a%W-b%W,(a-a%W)/W-(b-b%W)/W)}
 if(process.env.SAMPLE){const n=256*2**z;const out=[];for(let i=0;i<path.length;i+=Math.max(1,Math.floor(path.length/12))){const p=path[i];const X=p%W+x0,Y=Math.floor(p/W)+y0;out.push((Math.atan(Math.sinh(Math.PI*(1-2*Y/n)))*180/Math.PI).toFixed(5)+','+(X/n*360-180).toFixed(5)+':'+C[p])}console.log(out.join(' '))}
 let mwFrac=0; for(const p of path) if(C[p]===MW) mwFrac++;
 console.log(JSON.stringify({z,W,H,tiles,mpp:+mpp.toFixed(2),fetchDecodeMs:T1-T0,thinMs:T2-T1,searchMs:T3-T2,bridges,components:nc,iters:it,skeletonPx:sk,found:path.length>0,lengthM:Math.round(len*mpp),straightM:Math.round(Math.hypot(bx-ax,by-ay)*mpp),mwFrac:+(mwFrac/Math.max(1,path.length)).toFixed(2),pops}));
 // 画像: 元の地図（薄く）+ 骨格（灰）+ 経路（赤）。大きすぎるときは縮める
 const sc=Math.max(1,Math.ceil(Math.max(W,H)/1400)); const w2=Math.floor(W/sc),h2=Math.floor(H/sc); const img=new PNG({width:w2,height:h2});
 for(let y=0;y<h2;y++)for(let x=0;x<w2;x++){const p=(y*sc)*W+x*sc,o=(y*w2+x)*4;for(let c=0;c<3;c++)img.data[o+c]=255-(255-rgb[p*3+c])*0.7;img.data[o+3]=255}
 const dot=(p,col,r)=>{const X=Math.floor((p%W)/sc),Y=Math.floor(Math.floor(p/W)/sc);for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const x=X+dx,y=Y+dy;if(x<0||y<0||x>=w2||y>=h2)continue;const o=(y*w2+x)*4;img.data[o]=col[0];img.data[o+1]=col[1];img.data[o+2]=col[2]}};
 for(let p=0;p<W*H;p++) if(M[p]&&((p%W)%sc===0)&&(Math.floor(p/W)%sc===0)) dot(p,[120,120,120],0);
 for(let i=0;i<path.length;i++){dot(path[i],[230,0,0],1); if(i>0){const a=path[i-1],b=path[i];const ax2=a%W,ay2=Math.floor(a/W),bx2=b%W,by2=Math.floor(b/W);const n=Math.ceil(Math.hypot(bx2-ax2,by2-ay2));for(let k=1;k<n;k++){dot(Math.round(ay2+(by2-ay2)*k/n)*W+Math.round(ax2+(bx2-ax2)*k/n),[230,0,230],1)}}} dot(s,[0,0,255],4); dot(g,[0,0,255],4);
 fs.writeFileSync(out,PNG.sync.write(img));
})();
