(() => {
  "use strict";
  const R = 6378137, TILE = 256;
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const latLng = v => Array.isArray(v) ? {lat:+v[0],lng:+v[1]} : {lat:+(v.lat ?? v.latitude),lng:+(v.lng ?? v.lon ?? v.longitude)};
  const project = (ll,z) => { const p=latLng(ll),n=2**z,x=(p.lng+180)/360*n*TILE,s=Math.sin(clamp(p.lat,-85.05112878,85.05112878)*Math.PI/180),y=(.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n*TILE; return {x,y}; };
  const unproject = (p,z) => { const n=2**z*TILE,lng=p.x/n*360-180,y=Math.PI-2*Math.PI*p.y/n,lat=180/Math.PI*Math.atan(.5*(Math.exp(y)-Math.exp(-y))); return {lat,lng}; };
  const metersPerPixel = (lat,z) => Math.cos(lat*Math.PI/180)*2*Math.PI*R/(TILE*2**z);

  class LiteMap {
    constructor(id,options={}) {
      this.el=typeof id==="string"?document.getElementById(id):id; this.options=options; this.center={lat:37.1769,lng:-3.5977}; this.zoom=15; this.layers=[];
      this.el.classList.add("leaflet-container","lite-map");
      this.viewport=document.createElement("div"); this.viewport.className="lite-map-viewport";
      this.tiles=document.createElement("div"); this.tiles.className="lite-map-tiles";
      this.overlays=document.createElement("div"); this.overlays.className="lite-map-overlays";
      this.attribution=document.createElement("div"); this.attribution.className="leaflet-control-attribution"; this.attribution.innerHTML='© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';
      this.viewport.append(this.tiles,this.overlays); this.el.replaceChildren(this.viewport,this.attribution); this._ready=false; this._renderQueued=false; this._drag=null; this._wire();
      requestAnimationFrame(()=>{this._ready=true;this.render();});
    }
    _wire(){
      this.el.addEventListener("wheel",e=>{e.preventDefault();this.setView(this.center,clamp(this.zoom+(e.deltaY<0?1:-1),3,19));},{passive:false});
      this.el.addEventListener("pointerdown",e=>{this._drag={x:e.clientX,y:e.clientY,start:project(this.center,this.zoom)};this.el.setPointerCapture?.(e.pointerId);});
      this.el.addEventListener("pointermove",e=>{if(!this._drag)return;const dx=e.clientX-this._drag.x,dy=e.clientY-this._drag.y;this.center=unproject({x:this._drag.start.x-dx,y:this._drag.start.y-dy},this.zoom);this.render();});
      const end=()=>{this._drag=null;}; this.el.addEventListener("pointerup",end); this.el.addEventListener("pointercancel",end);
    }
    setView(center,zoom=this.zoom){this.center=latLng(center);this.zoom=clamp(Math.round(zoom),3,19);this.render();return this;}
    panTo(center){return this.setView(center,this.zoom);}
    fitBounds(bounds){const b=bounds._bounds||bounds,rect=this.el.getBoundingClientRect();for(let z=19;z>=3;z--){const a=project({lat:b.south,lng:b.west},z),c=project({lat:b.north,lng:b.east},z);if(Math.abs(c.x-a.x)<=rect.width*.75&&Math.abs(c.y-a.y)<=rect.height*.75){this.zoom=z;break;}}return this.setView([(b.south+b.north)/2,(b.west+b.east)/2],this.zoom);}
    invalidateSize(){this.render();return this;}
    whenReady(fn){if(this._ready)fn();else requestAnimationFrame(fn);return this;}
    addLayer(layer){if(!this.layers.includes(layer))this.layers.push(layer);layer._map=this;this.overlays.appendChild(layer.el);layer.update();return this;}
    render(){if(this._renderQueued)return;this._renderQueued=true;requestAnimationFrame(()=>{this._renderQueued=false;this._renderTiles();this.layers.forEach(l=>l.update());});}
    _renderTiles(){
      const rect=this.el.getBoundingClientRect();if(!rect.width||!rect.height)return;const cp=project(this.center,this.zoom),left=cp.x-rect.width/2,top=cp.y-rect.height/2;
      const x0=Math.floor(left/TILE),x1=Math.floor((left+rect.width)/TILE),y0=Math.floor(top/TILE),y1=Math.floor((top+rect.height)/TILE),needed=new Set(),n=2**this.zoom;
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){if(y<0||y>=n)continue;const wx=((x%n)+n)%n,key=`${this.zoom}/${wx}/${y}`;needed.add(key);let img=this.tiles.querySelector(`[data-key="${key}"]`);
        if(!img){img=new Image();img.dataset.key=key;img.alt="";img.decoding="async";img.loading="eager";img.className="lite-map-tile";img.referrerPolicy="no-referrer";img.src=`https://tile.openstreetmap.org/${this.zoom}/${wx}/${y}.png`;const timer=setTimeout(()=>{if(!img.complete){img.removeAttribute("src");img.classList.add("tile-timeout");}},7000);img.onload=()=>clearTimeout(timer);img.onerror=()=>{clearTimeout(timer);img.classList.add("tile-error");};this.tiles.appendChild(img);}
        img.style.transform=`translate3d(${x*TILE-left}px,${y*TILE-top}px,0)`;
      }
      this.tiles.querySelectorAll("img[data-key]").forEach(img=>{if(!needed.has(img.dataset.key))img.remove();});
    }
    pointFor(ll){const rect=this.el.getBoundingClientRect(),cp=project(this.center,this.zoom),p=project(ll,this.zoom);return{x:rect.width/2+p.x-cp.x,y:rect.height/2+p.y-cp.y};}
  }
  class DivIcon{constructor(options={}){Object.assign(this,options);}}
  class Marker{
    constructor(ll,options={}){this.ll=latLng(ll);this.options=options;this.el=document.createElement("div");this.el.className="lite-marker";const icon=options.icon||{};this.el.innerHTML=icon.html||"";if(icon.className)this.el.classList.add(icon.className);this.anchor=icon.iconAnchor||[17,17];this.el.style.zIndex=String(500+(options.zIndexOffset||0));}
    addTo(map){map.addLayer(this);return this;} setLatLng(ll){this.ll=latLng(ll);this.update();return this;} getElement(){return this.el.firstElementChild||this.el;} bindTooltip(text){this.el.title=text;return this;} on(type,fn){this.el.addEventListener(type,fn);return this;}
    update(){if(!this._map)return;const p=this._map.pointFor(this.ll);this.el.style.transform=`translate3d(${p.x-this.anchor[0]}px,${p.y-this.anchor[1]}px,0)`;}
  }
  class Circle{
    constructor(ll,options={}){this.ll=latLng(ll);this.options=options;this.radius=options.radius||0;this.el=document.createElement("div");this.el.className="lite-circle";Object.assign(this.el.style,{border:`${options.weight||1}px solid ${options.color||'#61e7ff'}`,background:options.fillColor||'#61e7ff',opacity:String(options.fillOpacity??.08)});}
    addTo(map){map.addLayer(this);return this;} setLatLng(ll){this.ll=latLng(ll);this.update();return this;} setRadius(r){this.radius=r;this.update();return this;}
    update(){if(!this._map)return;const p=this._map.pointFor(this.ll),px=Math.max(4,this.radius/metersPerPixel(this.ll.lat,this._map.zoom));this.el.style.width=`${px*2}px`;this.el.style.height=`${px*2}px`;this.el.style.transform=`translate3d(${p.x-px}px,${p.y-px}px,0)`;}
  }
  class Bounds{constructor(points){const ps=points.map(latLng);this._bounds={south:Math.min(...ps.map(p=>p.lat)),north:Math.max(...ps.map(p=>p.lat)),west:Math.min(...ps.map(p=>p.lng)),east:Math.max(...ps.map(p=>p.lng))};}pad(r){const b=this._bounds,dy=(b.north-b.south)||.002,dx=(b.east-b.west)||.002;return new Bounds([[b.south-dy*r,b.west-dx*r],[b.north+dy*r,b.east+dx*r]]);}}
  class TileLayer{constructor(url,options={}){this.url=url;this.options=options;this.handlers={};}addTo(map){map.tileLayer=this;return this;}on(type,fn){this.handlers[type]=fn;return this;}}
  const control={zoom:()=>({addTo(map){const box=document.createElement("div");box.className="lite-zoom";const plus=document.createElement("button"),minus=document.createElement("button");plus.textContent="+";minus.textContent="−";plus.onclick=()=>map.setView(map.center,map.zoom+1);minus.onclick=()=>map.setView(map.center,map.zoom-1);box.append(plus,minus);map.el.appendChild(box);return this;}})};
  window.L={map:(id,o)=>new LiteMap(id,o),tileLayer:(u,o)=>new TileLayer(u,o),divIcon:o=>new DivIcon(o),marker:(ll,o)=>new Marker(ll,o),circle:(ll,o)=>new Circle(ll,o),latLngBounds:ps=>new Bounds(ps),control};
})();
