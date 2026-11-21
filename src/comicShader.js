import * as THREE from 'three';

export const tuning = {
  gravity:42, jump:21.5, baseSpeed:25, dash:20, grapple:55, slam:48, superJump:1.75
};

const toonSteps=new THREE.DataTexture(new Uint8Array([11,34,104,232,250]),5,1,THREE.RedFormat);
toonSteps.needsUpdate=true;toonSteps.magFilter=THREE.NearestFilter;toonSteps.minFilter=THREE.NearestFilter;toonSteps.generateMipmaps=false;

export function toonMaterial(color, options={}) {
  return new THREE.MeshToonMaterial({color,gradientMap:toonSteps,...options});
}

const indiaInk = new THREE.Color('#0c0c0f');
const newsprint = new THREE.Color('#ebe2cf');
const inkCel = {value: 0};
const hullMaterial = new THREE.MeshBasicMaterial({color: indiaInk, side: THREE.BackSide, toneMapped: false});
const creaseMaterial = new THREE.LineBasicMaterial({color: indiaInk, toneMapped: false});
const hatchedMaterials = new WeakSet();
for (const material of [hullMaterial, creaseMaterial]) {
  material.onBeforeCompile = shader => {
    shader.uniforms.inkCel = inkCel;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float inkCel;')
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vec3 inkPoint = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 inkWave = vec3(inkPoint.y * 1.21 + inkPoint.z * 0.83, inkPoint.z + inkPoint.x * 1.63, inkPoint.x + inkPoint.y * 1.45);
        transformed += 0.009 * sin(inkWave + inkCel * 1.58);
      `);
  };
}

export function setInkCel(cel) {
  inkCel.value = cel % 4;
}

function inkWash(material) {
  if (!material.isMeshToonMaterial || hatchedMaterials.has(material)) return;
  hatchedMaterials.add(material);
  material.customProgramCacheKey = () => 'rubber-hose-ink-wash';
  material.onBeforeCompile = shader => {
    shader.uniforms.inkPigment = {value: indiaInk};
    shader.uniforms.inkPaper = {value: newsprint};
    shader.uniforms.inkCel = inkCel;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vInkWorld;')
      .replace('#include <project_vertex>', `
        #include <project_vertex>
        vec4 inkPosition = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          inkPosition = batchingMatrix * inkPosition;
        #endif
        #ifdef USE_INSTANCING
          inkPosition = instanceMatrix * inkPosition;
        #endif
        vInkWorld = (modelMatrix * inkPosition).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `
        #include <common>
        varying vec3 vInkWorld;
        uniform vec3 inkPigment;
        uniform vec3 inkPaper;
        uniform float inkCel;

        float penStroke(float coordinate, float width) {
          float aa = max(fwidth(coordinate), 0.001);
          float edge = abs(fract(coordinate) - 0.5);
          return (1.0 - smoothstep(width - aa * 0.5, width + aa * 0.5, edge))
            * (1.0 - smoothstep(0.34, 0.78, aa));
        }
      `)
      .replace('#include <opaque_fragment>', `
        vec3 luminosity = vec3(0.2126, 0.7152, 0.0722);
        float pigment = max(dot(diffuseColor.rgb, luminosity), 0.018);
        float exposure = dot(reflectedLight.directDiffuse + 0.38 * reflectedLight.indirectDiffuse, luminosity) / pigment;
        float lit = smoothstep(0.12, 0.82, exposure);
        vec3 worldNormal = normalize(cross(dFdx(vInkWorld), dFdy(vInkWorld)));
        vec3 weights = abs(worldNormal);
        vec2 paperUV = weights.y > max(weights.x, weights.z) ? vInkWorld.xz
          : weights.x > weights.z ? vInkWorld.zy : vInkWorld.xy;
        float wobble = 0.09 * sin(paperUV.x * 2.6 + paperUV.y * 1.35 + inkCel * 1.7);
        float strokes = penStroke((paperUV.x + paperUV.y * 1.58) * 7.0 + wobble, 0.14);
        float crosses = penStroke((paperUV.x - paperUV.y * 1.45) * 5.4 - wobble, 0.11);
        vec2 dotUV = mat2(0.8, -0.6, 0.6, 0.8) * paperUV * 10.0;
        float dotAA = max(length(fwidth(dotUV)), 0.001);
        float dots = (1.0 - smoothstep(0.16 - dotAA * 0.4, 0.16 + dotAA * 0.4, length(fract(dotUV) - 0.5)))
          * (1.0 - smoothstep(0.33, 0.74, dotAA));
        float marks = max(strokes * (1.0 - lit) * 0.68,
          max(crosses * (1.0 - smoothstep(0.03, 0.44, lit)) * 0.64, dots * (1.0 - lit) * 0.36));
        float paperMix = smoothstep(0.015, 0.49, pigment) * (1.0 - 0.55 * (max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b))
          - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b))));
        vec3 wash = diffuseColor.rgb * (0.65 + 0.62 * lit);
        wash = mix(wash, inkPaper, paperMix * lit * 0.66);
        outgoingLight = mix(wash, outgoingLight - totalEmissiveRadiance, 0.32);
        outgoingLight = mix(outgoingLight, inkPigment, marks) + totalEmissiveRadiance;
        #include <opaque_fragment>
      `);
  };
}

export function warpRubberHoseGeometry(source, {seed = 0, flare = .065, bow, ridge = 0, jitter = .08} = {}) {
  let geometry;
  if (source.type === 'BoxGeometry') {
    const {width, height, depth} = source.parameters;
    const segments = size => THREE.MathUtils.clamp(Math.ceil(size / 1.35), 2, 36);
    geometry = new THREE.BoxGeometry(width, height, depth, segments(width), segments(height), segments(depth));
  } else if (source.type === 'CylinderGeometry' || source.type === 'ConeGeometry') {
    const {radiusTop, radiusBottom, radius, height, radialSegments, openEnded, thetaStart, thetaLength} = source.parameters;
    geometry = new THREE.CylinderGeometry(radiusTop ?? 0, radiusBottom ?? radius, height,
      Math.max(12, radialSegments), Math.max(2, Math.ceil(height / 1.35)), openEnded, thetaStart, thetaLength);
  } else {
    geometry = source.clone();
  }
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const amplitude = Math.min(jitter, Math.min(size.x, size.y, size.z) * .17);
  const tall = bow ?? THREE.MathUtils.smoothstep(size.y / Math.max(1, Math.min(size.x, size.z)), 1.8, 5);
  const lean = Math.min(.35, Math.max(.06, Math.min(size.x, size.z) * .55)) * tall;
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const level = (y - bounds.min.y) / Math.max(.001, size.y);
    const nx = x - center.x, nz = z - center.z;
    const wave = y * .25 + seed;
    // Bound lateral movement on city-length walls and bridges to keep adjoining trim aligned.
    const flareX = nx * flare * level / Math.max(1, size.x / 22);
    const flareZ = nz * flare * level / Math.max(1, size.z / 22);
    const alongRidge = size.x >= size.z ? nx / Math.max(.01, size.x) : nz / Math.max(.01, size.z);
    positions.setXYZ(i,
      x + flareX + lean * (Math.sin(wave) - Math.sin(bounds.min.y * .25 + seed)) * level +
        amplitude * Math.sin(x * .73 + y * .51 + z * .47 + seed),
      y + ridge * 4 * alongRidge * alongRidge * level + amplitude * Math.sin(x * .58 - y * .41 + z * .76 + seed + 2),
      z + flareZ + lean * Math.sin(wave + 1.2) * level * .55 +
        amplitude * Math.sin(x * .42 + y * .65 - z * .71 + seed + 4));
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createRubberHoseMesh(source, options) {
  const {material, outlined = true, thickness = 1, edgeWobble = .025, ...warp} = options;
  const geometry = warpRubberHoseGeometry(source, warp);
  inkWash(material);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  if (!outlined) return mesh;

  const hullGeometry = geometry.clone();
  const points = hullGeometry.attributes.position;
  const normals = geometry.attributes.normal;
  const directions = new Map(), keys = [];
  const normal = new THREE.Vector3();
  for (let i = 0; i < points.count; i++) {
    // Weld only the extrusion directions. The art surface keeps its UV seams and creases.
    const key = [points.getX(i), points.getY(i), points.getZ(i)].map(v => Math.round(v * 10000)).join('/');
    keys.push(key);
    if (!directions.has(key)) directions.set(key, new THREE.Vector3());
    directions.get(key).add(normal.fromBufferAttribute(normals, i));
  }
  const {min, max} = geometry.boundingBox;
  const extent = max.clone().sub(min);
  const weight = thickness * Math.min(1, Math.max(.18, Math.min(extent.x, extent.y, extent.z) * 2.8));
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i), y = points.getY(i), z = points.getZ(i);
    const level = (y - min.y) / Math.max(.001, extent.y);
    const direction = directions.get(keys[i]).normalize();
    const corner = 1 - Math.max(Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z));
    const width = (.063 + .026 * (1 - level) + .039 * corner + .004 * Math.sin(x * 1.1 + y * 2.1 + z)) * weight;
    points.setXYZ(i, x + direction.x * width, y + direction.y * width, z + direction.z * width);
  }
  hullGeometry.computeBoundingBox();
  hullGeometry.computeBoundingSphere();
  const hull = new THREE.Mesh(hullGeometry, hullMaterial);
  mesh.add(hull);

  const edgeGeometry = new THREE.EdgesGeometry(geometry, 22);
  const edges = edgeGeometry.attributes.position;
  const wobble = Math.min(edgeWobble, .025 * weight);
  for (let i = 0; i < edges.count; i++) {
    const x = edges.getX(i), y = edges.getY(i), z = edges.getZ(i);
    const end = i % 2 ? i - 1 : i + 1;
    const distance = Math.hypot(x - edges.getX(end), y - edges.getY(end), z - edges.getZ(end)) || 1;
    const overshoot = Math.min(.065, distance * .034) * weight / distance;
    let offset = directions.get([x, y, z].map(v => Math.round(v * 10000)).join('/'));
    offset ??= new THREE.Vector3();
    edges.setXYZ(i,
      x + offset.x * .021 * weight + wobble * Math.sin(y * 2.7 + z) + (x - edges.getX(end)) * overshoot,
      y + offset.y * .021 * weight + wobble * Math.sin(x * 2.2 + z) + (y - edges.getY(end)) * overshoot,
      z + offset.z * .021 * weight + wobble * Math.cos(x + y * 1.5) + (z - edges.getZ(end)) * overshoot);
  }
  mesh.add(new THREE.LineSegments(edgeGeometry, creaseMaterial));
  return mesh;
}

export function architectureTexture(base='#686a70',shade='#222328'){
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;const ctx=canvas.getContext('2d');
  const grad=ctx.createLinearGradient(0,0,1024,1024);grad.addColorStop(0,base);grad.addColorStop(1,shade);ctx.fillStyle=grad;ctx.fillRect(0,0,1024,1024);
  for(let x=0;x<=1024;x+=256){ctx.fillStyle='rgba(11,11,13,.20)';ctx.fillRect(x-2,0,4,1024);ctx.fillStyle='rgba(232,225,207,.16)';ctx.fillRect(x+2,0,2,1024);}
  for(let y=0;y<=1024;y+=256){ctx.fillStyle='rgba(11,11,13,.20)';ctx.fillRect(0,y-2,1024,4);ctx.fillStyle='rgba(232,225,207,.12)';ctx.fillRect(0,y+2,1024,2);}
  const dotField=(cx,cy,r)=>{ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip();for(let y=cy-r;y<cy+r;y+=14)for(let x=cx-r;x<cx+r;x+=14){const alpha=Math.max(0,.15*(1-Math.hypot(x-cx,y-cy)/r));ctx.fillStyle=`rgba(34,35,40,${alpha})`;ctx.beginPath();ctx.arc(x,y,1.5,0,Math.PI*2);ctx.fill();}ctx.restore();};
  dotField(80,80,240);dotField(944,944,225);
  ctx.strokeStyle='rgba(232,225,207,.12)';ctx.lineWidth=2;for(let i=0;i<4;i++){const inset=28+i*18;ctx.strokeRect(inset,inset,1024-inset*2,1024-inset*2);}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=8;return texture;
}

const film={ink:'#0b0b0d',charcoal:'#222328',smoke:'#686a70',parchment:'#e8e1cf',paper:'#faf6eb'};

export const visualModes = [
  '1930s Silver Screen',
  'Pure 1928 Black & White',
  'Two-Strip Technicolor (Cuphead Mode)',
  'Sepia Nickelodeon Reel',
  'Midnight Ink & Halftone'
];

export const noirFilmShader = {
  uniforms:{tDiffuse:{value:null},uMode:{value:0},uResolution:{value:new THREE.Vector2(1,1)}},
  vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:`
    uniform sampler2D tDiffuse;
    uniform int uMode;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float lum(vec3 rgb){return dot(rgb,vec3(.2126,.7152,.0722));}
    float sampleInk(vec2 offset){return lum(texture2D(tDiffuse,vUv+offset/uResolution).rgb);}
    vec3 twoStrip(float value,vec3 source){
      vec3 cyan=mix(vec3(.015,.043,.055),vec3(.066,.38,.40),smoothstep(.03,.5,value));
      vec3 red=mix(vec3(.55,.135,.093),vec3(1.0,.91,.65),smoothstep(.39,.98,value));
      float warm=smoothstep(.016,.21,source.r-source.b);
      return mix(cyan,red,smoothstep(.28,.74,value+.20*warm));
    }
    float printDots(float value){
      vec2 rotated=mat2(.866,-.5,.5,.866)*(vUv*uResolution);
      float pitch=clamp(uResolution.y/173.0,4.0,10.0);
      vec2 cell=fract(rotated/pitch)-.5;
      float radius=mix(.39,.10,smoothstep(.025,.54,value));
      return (1.0-smoothstep(radius-.08,radius+.08,length(cell)))*(1.0-smoothstep(.25,.64,value));
    }
    void main(){
      vec3 source=texture2D(tDiffuse,vUv).rgb;
      float value=lum(source);
      float gx=sampleInk(vec2(1.,-1.))+2.0*sampleInk(vec2(1.,0.))+sampleInk(vec2(1.,1.))
        -sampleInk(vec2(-1.,-1.))-2.0*sampleInk(vec2(-1.,0.))-sampleInk(vec2(-1.,1.));
      float gy=sampleInk(vec2(-1.,1.))+2.0*sampleInk(vec2(0.,1.))+sampleInk(vec2(1.,1.))
        -sampleInk(vec2(-1.,-1.))-2.0*sampleInk(vec2(0.,-1.))-sampleInk(vec2(1.,-1.));
      float edge=smoothstep(.16,.93,length(vec2(gx,gy)));
      vec3 ink=vec3(.038,.035,.045);
      vec3 film;

      if(uMode==1){
        film=vec3((value-.5)*1.25+.5);
        film=mix(film,vec3(.024),edge*.19);
      }else if(uMode==2){
        film=twoStrip(value,source);
        film=mix(film,vec3(.027,.025,.035),edge*.29);
      }else if(uMode==3){
        vec3 sepia=vec3(dot(source,vec3(.393,.769,.189)),dot(source,vec3(.349,.686,.168)),dot(source,vec3(.272,.534,.131)));
        film=mix(source,sepia,.85);
        film=mix(film,vec3(.08,.043,.025),edge*.25);
      }else if(uMode==4){
        float printValue=smoothstep(.045,.92,value);
        film=mix(vec3(.033,.031,.042),vec3(.99,.966,.90),printValue);
        film=mix(film,ink,max(edge*.84,printDots(value)*.78));
      }else{
        vec3 cream=vec3(1.025,1.002,.964)*value;
        float gold=smoothstep(.025,.22,source.r-source.b);
        film=mix(cream,source,.34+.66*gold);
        film=(film-.46)*1.09+.46;
        film=mix(film,ink,edge*.29);
      }
      gl_FragColor=vec4(clamp(film,0.0,1.0),1.0);
    }`
};

// Paint once over the composited viewport so the menus and the arena use the same reel.
export function createProjectorOverlay(canvas) {
  const ctx = canvas.getContext('2d');
  const tile = document.createElement('canvas');
  tile.width = tile.height = 144;
  const tileContext = tile.getContext('2d');
  const frames = [];
  let lastCel = -1, active = false, agedReel = false, vignette;
  const noise = seed => {
    const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
    return value - Math.floor(value);
  };

  function buildGrain() {
    if (frames.length) return;
    for (let i = 0; i < 12; i++) {
      const image = tileContext.createImageData(tile.width, tile.height);
      for (let p = 0; p < image.data.length; p += 4) {
        const color = Math.random() > .52 ? 247 : 11;
        image.data[p] = image.data[p+1] = image.data[p+2] = color;
        image.data[p+3] = Math.round(Math.pow(Math.random(), 2) * 46);
      }
      tileContext.putImageData(image, 0, 0);
      frames.push(ctx.createPattern(tile, 'repeat'));
    }
  }

  return {
    configure({grainEnabled, grain, visual}) {
      active = grainEnabled && grain > 0;
      agedReel = visual === 3;
      canvas.hidden = !active;
      canvas.style.opacity = grain;
      lastCel = -1;
      if (active) buildGrain();
    },
    resize(width, height) {
      // Keep the grain near pixel scale and cap the backing store on high-DPI displays.
      const scale = Math.min(.82, 1120 / width, 840 / height);
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      vignette = ctx.createRadialGradient(0, 0, .27, 0, 0, 1);
      vignette.addColorStop(0, 'transparent');
      vignette.addColorStop(.65, '#15101720');
      vignette.addColorStop(1, '#09070b6f');
      lastCel = -1;
    },
    draw(time, reducedMotion = false) {
      if (!active) return;
      const cel = reducedMotion ? 0 : Math.floor(time * 24);
      if (cel === lastCel) return;
      lastCel = cel;
      const {width, height} = canvas;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = frames[cel % frames.length];
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(width * .70, height * .70);
      ctx.globalAlpha = agedReel ? .91 : .51;
      ctx.fillStyle = vignette;
      ctx.fillRect(-.72, -.72, 1.44, 1.44);
      ctx.restore();
      if (reducedMotion) return;

      const flicker = noise(cel + 3) - .5;
      ctx.fillStyle = flicker > 0 ? '#fff8e7' : '#141016';
      ctx.globalAlpha = Math.abs(flicker) * (agedReel ? .077 : .032);
      ctx.fillRect(0, 0, width, height);
      const cycle = agedReel ? 22 : 39, phase = cel % cycle;
      const strip = Math.floor(cel / cycle);
      if (phase < 7) {
        for (let i = 0; i < (agedReel ? 6 : 3); i++) {
          const seed = strip * 19 + i * 11 + 2;
          const x = noise(seed) * width, y = noise(seed+3) * height;
          ctx.fillStyle = i % 2 ? '#f6e7d4' : '#120c0b';
          ctx.globalAlpha = (.34 - phase * .026) * (.4 + noise(seed+6));
          ctx.beginPath();
          ctx.ellipse(x, y, .55 + noise(seed+7) * 1.04, .42 + noise(seed+8) * .8, noise(seed+9), 0, Math.PI*2);
          ctx.fill();
        }
      }
      if (phase < 5 && noise(strip + 32) > (agedReel ? .38 : .71)) {
        const x = width * (.07 + noise(strip + 5) * .86) + phase * .29;
        ctx.strokeStyle = '#e7dbc4';
        ctx.globalAlpha = agedReel ? .33 : .20;
        ctx.lineWidth = .69;
        ctx.beginPath();
        ctx.moveTo(x, height * noise(strip + 3) * .55);
        ctx.lineTo(x + 1.3, height * (.62 + noise(strip + 12) * .34));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  };
}

export function cobblestoneTexture(){
  const c=document.createElement('canvas');c.width=1024;c.height=1024;const x=c.getContext('2d');
  x.fillStyle='#3a3c42';x.fillRect(0,0,1024,1024);
  const stones=['#45484f','#4c4f57','#41444b','#484b52','#3e4047'];
  // Muted flagstones sit close in value: their fine seams guide movement but
  // leave the cream characters and amber streetlamps as the main focal points.
  for(let row=-1;row<17;row++){const y=row*66,offset=row%2?54:0;for(let col=-1;col<14;col++){const seed=(row*37+col*19+4096)%11,xx=col*83+offset,w=73+(seed%4)*2,h=56+(seed%3)*2;x.beginPath();x.moveTo(xx+7,y+3);x.quadraticCurveTo(xx+w*.38,y-1,xx+w-5,y+5);x.lineTo(xx+w-2,y+h*.42);x.quadraticCurveTo(xx+w+2,y+h-4,xx+w*.55,y+h-2);x.lineTo(xx+4,y+h-5);x.quadraticCurveTo(xx-2,y+h*.5,xx+7,y+3);x.closePath();x.fillStyle=stones[seed%stones.length];x.fill();x.strokeStyle='rgba(11,11,13,.25)';x.lineWidth=2.4;x.stroke();
    x.strokeStyle='rgba(232,225,207,.12)';x.lineWidth=1.5;x.beginPath();x.moveTo(xx+12,y+8);x.quadraticCurveTo(xx+w*.42,y+4,xx+w-12,y+10);x.stroke();
    if(seed%5===1){x.strokeStyle='rgba(11,11,13,.22)';x.lineWidth=1.4;x.beginPath();x.moveTo(xx+w*.28,y+h*.58);x.lineTo(xx+w*.34,y+h*.68);x.lineTo(xx+w*.31,y+h*.79);x.lineTo(xx+w*.42,y+h*.9);x.stroke();}
  }}
  // A few restrained herringbone bands break up long sightlines without a
  // bright checkerboard or hard black block in the repeat tile.
  for(let band=0;band<2;band++){const bx=250+band*420;x.fillStyle='rgba(76,79,87,.44)';x.fillRect(bx,0,124,1024);x.save();x.beginPath();x.rect(bx+3,0,118,1024);x.clip();for(let row=-1;row<28;row++)for(let col=-1;col<4;col++){const cx=bx+col*42+(row%2)*21,cy=row*38,vertical=(row+col)%2===0;x.save();x.translate(cx,cy);if(vertical)x.rotate(Math.PI/2);x.beginPath();x.roundRect(-19,-15,38,30,3);x.fillStyle=stones[(row*3+col+20)%stones.length];x.fill();x.strokeStyle='rgba(11,11,13,.28)';x.lineWidth=2;x.stroke();x.restore();}x.restore();}
  // Rain-polished strokes and fine asphalt grain remain deliberately faint.
  x.strokeStyle='rgba(232,225,207,.12)';x.lineWidth=2;for(let i=0;i<25;i++){const px=(i*173+71)%1024,py=(i*127+93)%1024;x.beginPath();x.moveTo(px,py);x.quadraticCurveTo(px+12,py-4,px+22,py+1);x.stroke();}
  x.fillStyle='rgba(11,11,13,.035)';for(let i=0;i<1200;i++){const px=(i*197+31)%1024,py=(i*113+71)%1024;x.fillRect(px,py,1.3,1.3);}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=THREE.RepeatWrapping;t.wrapT=THREE.RepeatWrapping;t.repeat.set(24,24);t.anisotropy=8;return t;
}

export function brickworkTexture(){
  const c=document.createElement('canvas');c.width=1024;c.height=1024;const x=c.getContext('2d');x.fillStyle='#a39c8e';x.fillRect(0,0,1024,1024);
  for(let row=0;row<24;row++){const y=row*44,offset=row%2?62:0;for(let col=-1;col<10;col++){const xx=col*124+offset;x.fillStyle=['#e2d9c6','#a39c8e','#d6cebd','#8f887a'][(row*3+col+44)%4];x.fillRect(xx+3,y+3,116,38);x.strokeStyle='#141418';x.lineWidth=5;x.strokeRect(xx+2,y+2,118,40);x.strokeStyle='rgba(250,246,235,.48)';x.lineWidth=2;x.beginPath();x.moveTo(xx+9,y+7);x.lineTo(xx+110,y+7);x.stroke();
      if((row*5+col*3)%17===0){x.strokeStyle='rgba(11,11,13,.6)';x.lineWidth=3;for(let h=0;h<4;h++){x.beginPath();x.moveTo(xx+17+h*8,y+18);x.lineTo(xx+23+h*8,y+31);x.stroke();}}
    }}
  const shade=x.createLinearGradient(0,0,800,1024);shade.addColorStop(0,'rgba(11,11,13,.015)');shade.addColorStop(.55,'rgba(11,11,13,.07)');shade.addColorStop(1,'rgba(11,11,13,.32)');x.fillStyle=shade;x.fillRect(0,0,1024,1024);
  for(let i=0;i<22;i++){const px=(i*67)%1024,py=900+(i*29)%120,len=30+(i*31)%100;x.strokeStyle='rgba(20,20,24,.55)';x.lineWidth=4;x.beginPath();x.moveTo(px,py);x.lineTo(px+4,py+len);x.stroke();}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;return t;
}

export function mouseTargetTexture(){
  const c=document.createElement('canvas');c.width=512;c.height=768;const x=c.getContext('2d');x.clearRect(0,0,512,768);const ink=film.ink,white=film.paper,mid=film.smoke;
  const shape=(p,fill,width=13)=>{x.beginPath();p.forEach(([a,b],i)=>i?x.lineTo(a,b):x.moveTo(a,b));x.closePath();x.fillStyle=fill;x.fill();x.lineJoin='round';x.lineCap='round';x.lineWidth=width;x.strokeStyle=ink;x.stroke();};
  // Ears, pie-cut eyes, tuxedo body and little fedora, all transparent sprite art.
  x.fillStyle=ink;x.beginPath();x.ellipse(170,227,63,95,-.28,0,Math.PI*2);x.fill();x.beginPath();x.ellipse(344,219,65,99,.25,0,Math.PI*2);x.fill();x.fillStyle=mid;x.beginPath();x.ellipse(170,227,36,64,-.28,0,Math.PI*2);x.fill();x.beginPath();x.ellipse(344,219,36,65,.25,0,Math.PI*2);x.fill();
  x.beginPath();x.ellipse(256,300,142,151,0,0,Math.PI*2);x.fillStyle=ink;x.fill();x.beginPath();x.ellipse(256,318,116,121,0,0,Math.PI*2);x.fillStyle=white;x.fill();x.strokeStyle=ink;x.lineWidth=12;x.stroke();
  x.fillStyle=ink;x.beginPath();x.moveTo(194,280);x.lineTo(240,294);x.lineTo(201,308);x.closePath();x.fill();x.beginPath();x.moveTo(266,294);x.lineTo(312,279);x.lineTo(305,309);x.closePath();x.fill();x.fillStyle=white;x.beginPath();x.arc(215,297,8,0,Math.PI*2);x.fill();x.beginPath();x.arc(290,296,8,0,Math.PI*2);x.fill();
  x.beginPath();x.ellipse(257,354,35,23,0,0,Math.PI*2);x.fillStyle=mid;x.fill();x.strokeStyle=ink;x.lineWidth=9;x.stroke();x.fillStyle=ink;x.beginPath();x.arc(257,348,15,0,Math.PI*2);x.fill();x.strokeStyle=ink;x.lineWidth=6;x.beginPath();x.arc(257,357,21,.2,Math.PI-.2);x.stroke();
  shape([[136,236],[177,182],[258,165],[338,183],[379,237],[336,224],[177,224]],ink,14);x.fillStyle=mid;x.fillRect(177,210,164,14);x.strokeStyle=white;x.lineWidth=5;x.beginPath();x.moveTo(184,211);x.lineTo(336,211);x.stroke();
  shape([[163,433],[204,411],[310,411],[356,439],[397,675],[111,675]],ink,16);shape([[200,430],[256,478],[309,430],[335,655],[176,655]],white,9);x.fillStyle=mid;x.strokeStyle=ink;x.lineWidth=8;x.beginPath();x.moveTo(220,462);x.lineTo(249,490);x.lineTo(229,511);x.lineTo(211,482);x.closePath();x.fill();x.stroke();x.beginPath();x.moveTo(294,462);x.lineTo(265,490);x.lineTo(286,511);x.lineTo(304,482);x.closePath();x.fill();x.stroke();
  x.strokeStyle=ink;x.lineWidth=5;for(let y=526;y<636;y+=27){x.beginPath();x.moveTo(196,y);x.lineTo(228,y+7);x.stroke();}
  // Squat legs and white gloves, with pie cuffs and stitched backs.
  x.strokeStyle=ink;x.lineWidth=20;x.lineCap='round';x.beginPath();x.moveTo(181,647);x.bezierCurveTo(140,687,132,716,162,730);x.stroke();x.beginPath();x.moveTo(320,647);x.bezierCurveTo(369,685,359,715,329,733);x.stroke();
  x.fillStyle=white;x.strokeStyle=ink;x.lineWidth=12;x.beginPath();x.ellipse(157,733,45,35,-.22,0,Math.PI*2);x.fill();x.stroke();x.beginPath();x.ellipse(333,735,45,35,.22,0,Math.PI*2);x.fill();x.stroke();
  x.strokeStyle=ink;x.lineWidth=5;for(let i=0;i<3;i++){x.beginPath();x.moveTo(139+i*9,722);x.lineTo(146+i*9,741);x.stroke();x.beginPath();x.moveTo(315+i*9,723);x.lineTo(322+i*9,742);x.stroke();}
  // Thick, rough outer ink and a cream highlight to retain legibility in the noir grade.
  x.strokeStyle='rgba(250,246,235,.65)';x.lineWidth=3;x.beginPath();x.ellipse(256,300,148,157,0,-2.4,-.6);x.stroke();
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}

export function skylineFacadeTexture(seed=1){
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;const ctx=canvas.getContext('2d');
  const grad=ctx.createLinearGradient(0,0,1024,1024);grad.addColorStop(0,'#a39c8e');grad.addColorStop(.42,'#686a70');grad.addColorStop(1,'#222328');ctx.fillStyle=grad;ctx.fillRect(0,0,1024,1024);
  ctx.fillStyle='rgba(20,20,24,.58)';for(let x=16;x<1024;x+=128)ctx.fillRect(x,0,13,1024);
  let s=seed|0;const rand=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
  for(let row=0;row<12;row++)for(let col=0;col<9;col++){
    const x=30+col*110,y=32+row*79,w=40+rand()*27,h=28+rand()*18;
    const lit=rand()>.32;ctx.fillStyle=lit?(rand()>.55?'#ffd166':'#f6efe0'):'rgba(20,20,24,.86)';ctx.fillRect(x,y,w,h);
    if(lit){ctx.fillStyle='rgba(250,246,235,.62)';ctx.fillRect(x+4,y+3,3,h-6);ctx.fillStyle='rgba(20,20,24,.55)';ctx.fillRect(x+w-4,y,4,h);}
  }
  // Inked facade seams, rooftop shadow blocks, and restrained print-registration color.
  ctx.fillStyle='rgba(11,11,13,.9)';ctx.fillRect(0,0,1024,20);ctx.fillRect(0,984,1024,40);
  ctx.strokeStyle='rgba(232,225,207,.32)';ctx.lineWidth=4;for(let x=0;x<1024;x+=256){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,1024);ctx.stroke();}
  ctx.save();ctx.globalAlpha=.22;ctx.fillStyle='#faf6eb';ctx.fillRect(10,28,7,944);ctx.fillStyle='#686a70';ctx.fillRect(20,28,5,944);ctx.restore();
  ctx.save();ctx.globalAlpha=.24;ctx.fillStyle='#e8e1cf';for(let y=10;y<310;y+=15)for(let x=10;x<330;x+=15){if((x+y)%45<20){ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);ctx.fill();}}ctx.restore();
  ctx.strokeStyle='#0b0b0d';ctx.lineWidth=18;ctx.strokeRect(7,7,1010,1010);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;return texture;
}

export function halftoneMoonTexture(){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,512,512);
  const g=ctx.createRadialGradient(210,190,18,256,256,248);g.addColorStop(0,'#faf6eb');g.addColorStop(.56,'#e8e1cf');g.addColorStop(.84,'#686a70');g.addColorStop(1,'rgba(104,106,112,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(256,256,248,0,Math.PI*2);ctx.fill();
  ctx.save();ctx.beginPath();ctx.arc(256,256,238,0,Math.PI*2);ctx.clip();ctx.globalAlpha=.34;ctx.fillStyle='#222328';for(let y=28;y<512;y+=13)for(let x=28;x<512;x+=13){const density=Math.max(0,1-Math.hypot(x-300,y-300)/330);if((x*13+y*7)%23<9){ctx.beginPath();ctx.arc(x,y,1+3*density,0,Math.PI*2);ctx.fill();}}ctx.restore();
  ctx.strokeStyle='#0b0b0d';ctx.lineWidth=13;ctx.beginPath();ctx.arc(256,256,241,0,Math.PI*2);ctx.stroke();
  for(const [x,y,r] of [[150,175,25],[337,288,19],[220,357,33]]){ctx.fillStyle='rgba(34,35,40,.2)';ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(11,11,13,.38)';ctx.lineWidth=4;ctx.stroke();}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

export function noirSkyTexture(){
  const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1024;const ctx=canvas.getContext('2d');
  const gradient=ctx.createLinearGradient(0,0,0,1024);gradient.addColorStop(0,'#17202c');gradient.addColorStop(.49,'#333946');gradient.addColorStop(1,'#5b544b');ctx.fillStyle=gradient;ctx.fillRect(0,0,2048,1024);
  // Soft print-screen stars and a little horizon silvering.
  const haze=ctx.createLinearGradient(0,600,0,1024);haze.addColorStop(0,'rgba(232,220,194,0)');haze.addColorStop(1,'rgba(232,220,194,.22)');ctx.fillStyle=haze;ctx.fillRect(0,600,2048,424);
  for(let i=0;i<370;i++){const x=(i*733+91)%2048,y=(i*337+47)%650,r=.5+(i%4)*.32;ctx.fillStyle=`rgba(248,241,222,${.16+(i%5)*.035})`;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
  // Hand-inked full moon with stippled craters and pen hatching.
  const mx=530,my=379,mr=115;
  ctx.save();
  ctx.translate(mx,my);ctx.scale(63/mr,63/mr);ctx.translate(-mx,-my);
  ctx.fillStyle='#f8f1de';ctx.beginPath();ctx.arc(mx,my,mr,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#141418';ctx.lineWidth=9;ctx.stroke();
  ctx.clip();
  ctx.beginPath();ctx.arc(mx-35,my-9,mr*.84,-1.08,1.05);ctx.strokeStyle='rgba(20,20,24,.58)';ctx.lineWidth=5;ctx.stroke();
  for(const [cx,cy,r] of [[mx-44,my-38,18],[mx+34,my-26,12],[mx+20,my+39,24],[mx-53,my+44,10]]){ctx.fillStyle='rgba(143,136,122,.42)';ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#141418';ctx.lineWidth=3;ctx.stroke();ctx.save();ctx.beginPath();ctx.arc(cx,cy,r-2,0,Math.PI*2);ctx.clip();ctx.strokeStyle='rgba(20,20,24,.45)';ctx.lineWidth=2;for(let n=-r;n<r;n+=7){ctx.beginPath();ctx.moveTo(cx+n,cy-r);ctx.lineTo(cx+n+r*1.5,cy+r);ctx.stroke();}ctx.restore();}
  ctx.fillStyle='rgba(20,20,24,.28)';for(let y=my-mr;y<my+mr;y+=10)for(let x=mx-mr;x<mx+mr;x+=10)if((x*3+y*5)%29<12&&Math.hypot(x-mx,y-my)<mr-4){ctx.beginPath();ctx.arc(x,y,1.5,0,Math.PI*2);ctx.fill();}ctx.restore();
  const cloud=(cx,cy,w,h)=>{ctx.save();ctx.translate(cx,cy);ctx.beginPath();ctx.moveTo(-w*.5,h*.22);ctx.bezierCurveTo(-w*.55,-h*.1,-w*.38,-h*.34,-w*.2,-h*.18);ctx.bezierCurveTo(-w*.15,-h*.55,w*.06,-h*.55,w*.12,-h*.2);ctx.bezierCurveTo(w*.21,-h*.55,w*.47,-h*.4,w*.39,-h*.08);ctx.bezierCurveTo(w*.62,-h*.18,w*.57,h*.12,w*.43,h*.23);ctx.lineTo(-w*.45,h*.23);ctx.closePath();ctx.fillStyle='#ece4d2';ctx.fill();ctx.lineJoin='round';ctx.strokeStyle='#141418';ctx.lineWidth=7;ctx.stroke();ctx.save();ctx.clip();ctx.strokeStyle='rgba(20,20,24,.48)';ctx.lineWidth=2.2;for(let x=-w*.52;x<w*.55;x+=11){ctx.beginPath();ctx.moveTo(x,h*.24);ctx.lineTo(x+w*.18,-h*.02);ctx.stroke();}ctx.restore();ctx.strokeStyle='rgba(250,246,235,.56)';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-w*.34,-h*.02);ctx.quadraticCurveTo(-w*.22,-h*.3,-w*.08,-h*.19);ctx.stroke();ctx.restore();};
  cloud(226,353,375,112);cloud(822,421,392,124);cloud(1240,250,355,105);cloud(1775,367,460,133);cloud(92,655,390,120);cloud(1060,650,440,135);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=THREE.RepeatWrapping;texture.wrapT=THREE.ClampToEdgeWrapping;texture.anisotropy=8;return texture;
}

export function addOutline(mesh, scale=1.035) {
  const hull=new THREE.Mesh(mesh.geometry,new THREE.MeshBasicMaterial({color:0x0b0b0d,side:THREE.BackSide,depthWrite:false}));
  hull.scale.setScalar(scale);hull.renderOrder=mesh.renderOrder-1;mesh.add(hull);
  const edges=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry,24),new THREE.LineBasicMaterial({color:0x0b0b0d,linewidth:2,transparent:false,depthTest:true}));
  edges.renderOrder=mesh.renderOrder+1;edges.position.z+=.002;mesh.add(edges);
  return {hull,edges};
}

export function graffitiTexture(label='MOUSEBERG DAILY', base='#222328', accent='#e8e1cf') {
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;const ctx=canvas.getContext('2d');
  ctx.fillStyle=base;ctx.fillRect(0,0,1024,1024);ctx.fillStyle='#686a70';ctx.fillRect(0,0,1024,40);ctx.fillRect(0,984,1024,40);
  ctx.strokeStyle='#0b0b0d';ctx.lineWidth=22;ctx.strokeRect(12,12,1000,1000);ctx.strokeStyle='#faf6eb';ctx.lineWidth=5;ctx.strokeRect(31,31,962,962);
  ctx.save();ctx.globalAlpha=.28;ctx.fillStyle='#e8e1cf';for(let y=18;y<1024;y+=15)for(let x=18;x<1024;x+=15){if((x*7+y*11)%29<14){ctx.beginPath();ctx.arc(x,y,1.7,0,Math.PI*2);ctx.fill();}}ctx.restore();
  ctx.fillStyle='#0b0b0d';ctx.fillRect(86,105,852,805);ctx.fillStyle='#686a70';ctx.fillRect(111,130,802,755);ctx.fillStyle='#e8e1cf';ctx.fillRect(134,153,756,709);
  ctx.fillStyle='#faf6eb';ctx.font='900 72px Georgia,serif';ctx.textAlign='center';ctx.fillText(label.toUpperCase(),512,220);ctx.strokeStyle='#0b0b0d';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(173,244);ctx.lineTo(851,244);ctx.stroke();
  ctx.fillStyle='#222328';ctx.font='italic 900 155px Georgia,serif';ctx.fillText(label==='WANTED'?'WANTED':'MOUSEBERG',512,410);ctx.font='bold 42px Georgia,serif';ctx.fillText('EVENING EDITION  •  EXTRA',512,472);
  ctx.fillStyle='#686a70';for(let col=0;col<3;col++)for(let row=0;row<7;row++){ctx.fillRect(181+col*226,520+row*37,180+(row+col)%3*18,7);}ctx.fillStyle='#222328';ctx.fillRect(198,790,628,14);ctx.fillStyle='#0b0b0d';ctx.font='italic 36px Georgia,serif';ctx.fillText('THE CITY NEVER SLEEPS',512,841);
  ctx.strokeStyle='#0b0b0d';ctx.lineWidth=10;for(let i=0;i<15;i++){const x=55+i*67;ctx.beginPath();ctx.moveTo(x,100);ctx.lineTo(x,22+(i*47)%78);ctx.stroke();}ctx.fillStyle=accent;ctx.globalAlpha=.36;ctx.fillRect(0,924,1024,42);ctx.globalAlpha=1;
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=8;return texture;
}

export function comicText(scene,text,position,color='#faf6eb',size=1.1,duration=1) {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=160;const ctx=canvas.getContext('2d');
  ctx.font='italic 900 94px Georgia, serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=18;ctx.strokeStyle='#0b0b0d';ctx.strokeText(text,256,80);ctx.fillStyle='#faf6eb';ctx.fillText(text,256,80);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const material=new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false});
  const sprite=new THREE.Sprite(material);sprite.position.copy(position);sprite.scale.set(size*3.3,size,1);scene.add(sprite);
  const start=performance.now();const animate=()=>{if(!sprite.parent)return;const t=(performance.now()-start)/1000;sprite.position.y+=.008;sprite.material.opacity=Math.max(0,1-t/duration);sprite.scale.multiplyScalar(1.005);if(t>duration){scene.remove(sprite);texture.dispose();material.dispose();}else requestAnimationFrame(animate);};requestAnimationFrame(animate);return sprite;
}

export function burst(scene,position,color=0xe8e1cf,count=12,speed=7) {
  const group=new THREE.Group();group.position.copy(position);scene.add(group);const start=performance.now();
  for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,b=(Math.random()-.5)*Math.PI,dir=new THREE.Vector3(Math.cos(a)*Math.cos(b),Math.sin(b),Math.sin(a)*Math.cos(b));const pts=[new THREE.Vector3(),dir.clone().multiplyScalar(.35+Math.random()*.35),dir.clone().multiplyScalar(.7+Math.random()*1.1)];group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:i%3===0?0x0b0b0d:0xe8e1cf,transparent:true,opacity:1})));}
  const tick=()=>{const t=(performance.now()-start)/450;if(t>=1){scene.remove(group);group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});return;}group.scale.setScalar(1+t*1.8);group.children.forEach(line=>line.material.opacity=1-t);requestAnimationFrame(tick);};requestAnimationFrame(tick);return group;
}

export const rubberHoseCast=[
  {id:'slinky',name:'SLINKY DRAKE',glove:'#faf6eb',accent:'#e8e1cf'},
  {id:'velvet',name:'MISS VELVET',glove:'#e8e1cf',accent:'#686a70'},
  {id:'bug',name:'CHUCKLES THE BUG',glove:'#faf6eb',accent:'#faf6eb'},
  {id:'parsnip',name:'SALTY PARSNIP',glove:'#e8e1cf',accent:'#686a70'},
  {id:'kitty',name:'KITTY CAPER',glove:'#faf6eb',accent:'#222328'},
  {id:'hattie',name:'HALO HATTIE',glove:'#faf6eb',accent:'#e8e1cf'},
];
export const rubberHoseArsenal=[
  {id:'automatic',name:'CHICAGO TYPEWRITER',short:'AUTOMATIC',mag:40,rate:10.5,damage:14,reload:1.45,zoom:1,spread:.4,speed:1},
  {id:'grease',name:'GREASE-POPPER',short:'SUBMACHINE GUN',mag:32,rate:14.5,damage:10,reload:1.25,zoom:1,spread:.28,speed:1.1},
  {id:'sniper',name:'LONG-NOSE CARBINE',short:'SNIPER',mag:6,rate:1.1,damage:55,headDamage:95,reload:1.9,zoom:2.8,spread:.035,speed:1},
];
export const weaponFinishes=[
  {id:'standard',name:'STANDARD INK & STEEL',metal:'#25272e',shade:'#1b1c23',barrel:'#25272e',highlight:'#686a70',wood:'#85725d',grain:'#4a3c35',trim:'#f4ebd9',drum:'#454750',flash:'#ffe8a0'},
  {id:'gold',name:'24K SPEAKEASY GOLD',metal:'#f2b84b',shade:'#a36623',barrel:'#e8aa3e',highlight:'#ffd37c',wood:'#532820',grain:'#351817',trim:'#fff0b3',drum:'#c78729',flash:'#ffc53e'},
  {id:'ivory',name:'IVORY & PEARL DETECTIVE',metal:'#f7f1e3',shade:'#27262c',barrel:'#c8c9cf',highlight:'#fffdf5',wood:'#222126',grain:'#151418',trim:'#c1c3cb',drum:'#aeb0bb',flash:'#fff1c8'},
  {id:'crimson',name:'CRIMSON MOBSTER SPECIAL',metal:'#b82b2b',shade:'#601823',barrel:'#b82b2b',highlight:'#e1584e',wood:'#352225',grain:'#21151a',trim:'#e2b35d',drum:'#b88539',flash:'#ffce79'},
];
function drawPreviewGun(ctx,weapon='automatic',time=0,action={}){
  if(!ctx)return;
  const selected=rubberHoseArsenal.find(w=>w.id===weapon)||rubberHoseArsenal[0],pose=Math.floor(time*12)%4,bob=Math.sin(pose*Math.PI/2)*3,pulse=action.pulse||0,flash=!!action.flash;
  ctx.save();ctx.translate(0,bob);ctx.rotate(-.13+Math.sin(pose*Math.PI/2)*.012);ctx.scale(1+pulse*.055,1-pulse*.035);
  const finish=weaponFinishes.find(item=>item.id===action.finish)??weaponFinishes[0];
  const {metal,barrel,highlight,wood,grain,trim,drum}=finish;
  const ink='#0b0b0d',cream='#e8e1cf',paper='#faf6eb';
  const shape=(points,fill,width=8)=>{ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.lineJoin='round';ctx.lineCap='round';ctx.lineWidth=width;ctx.strokeStyle=ink;ctx.stroke();};
  const line=(pts,width=7,color=ink)=>{ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i][0],pts[i][1]);ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=width;ctx.strokeStyle=color;ctx.stroke();};
  const glove=(x,y,s=1)=>{ctx.save();ctx.translate(x,y);ctx.scale(s,s);shape([[-23,7],[-30,-6],[-19,-19],[-9,-15],[-8,-31],[4,-34],[12,-16],[23,-29],[33,-22],[29,-5],[39,1],[31,18],[13,25],[-7,23]],paper,6);shape([[-28,-4],[-40,-6],[-43,11],[-33,19],[-23,14]],cream,5);for(let i=0;i<3;i++)line([[-2+i*7,3],[5+i*7,10]],3,ink);ctx.restore();};
  // Stock, receiver, and barrel share a common silhouette, with a distinct profile per gun.
  shape([[-202,-16],[-184,-46],[-145,-51],[-110,-37],[-90,-22],[-93,28],[-126,43],[-163,29],[-195,21]],wood,9);
  line([[-183,-29],[-151,-36],[-118,-22]],3,trim);for(let i=0;i<7;i++)line([[-185+i*10,-3],[-171+i*10,17]],2,grain);
  const barrelEnd=weapon==='sniper'?208:weapon==='grease'?150:178;
  shape([[-105,-31],[-62,-47],[2,-42],[40,-28],[62,-14],[58,24],[31,40],[-48,32],[-101,19]],metal,10);
  shape([[-80,-23],[-38,-36],[14,-31],[35,-15],[26,22],[-38,25],[-77,12]],highlight,4);
  if(weapon==='sniper'){
    shape([[14,-24],[barrelEnd-10,-22],[barrelEnd,-13],[barrelEnd,1],[barrelEnd-10,9],[12,7]],barrel,8);
    shape([[-30,2],[-7,4],[-10,50],[-22,61],[-37,48]],wood,6);
    ctx.beginPath();ctx.ellipse(55,-51,13,28,-.06,0,Math.PI*2);ctx.fillStyle='transparent';ctx.lineWidth=7;ctx.strokeStyle=ink;ctx.stroke();line([[55,-24],[55,-7]],4,ink);
    line([[barrelEnd-15,-22],[barrelEnd-15,-6]],4,paper);line([[barrelEnd-2,-25],[barrelEnd-2,10]],5,ink);
  }else if(weapon==='grease'){
    shape([[15,-25],[barrelEnd-14,-31],[barrelEnd,-19],[barrelEnd-8,-3],[barrelEnd-18,7],[12,3]],barrel,8);
    shape([[barrelEnd-20,-32],[barrelEnd+3,-37],[barrelEnd+14,-27],[barrelEnd+4,-17],[barrelEnd-19,-19]],highlight,6);
    ctx.beginPath();ctx.arc(72,-43,19,0,Math.PI*2);ctx.fillStyle='transparent';ctx.lineWidth=6;ctx.strokeStyle=ink;ctx.stroke();ctx.beginPath();ctx.arc(-21,-31,8,0,Math.PI*2);ctx.fillStyle=cream;ctx.fill();ctx.strokeStyle=ink;ctx.lineWidth=4;ctx.stroke();
  }else{
    shape([[7,-28],[barrelEnd-27,-31],[barrelEnd-17,-16],[barrelEnd-22,2],[3,4]],barrel,8);
    for(let i=0;i<6;i++)line([[78+i*11,-27],[78+i*11,-5]],4,ink);
    shape([[barrelEnd-22,-34],[barrelEnd+1,-34],[barrelEnd+8,-25],[barrelEnd+8,3],[barrelEnd-15,3],[barrelEnd-22,-8]],highlight,6);
    ctx.beginPath();ctx.arc(-5,48,48,0,Math.PI*2);ctx.fillStyle=drum;ctx.fill();ctx.strokeStyle=ink;ctx.lineWidth=7;ctx.stroke();ctx.beginPath();ctx.arc(-5,48,31,0,Math.PI*2);ctx.strokeStyle=trim;ctx.lineWidth=4;ctx.stroke();for(let i=0;i<8;i++){const a=i*Math.PI/4;line([[-5+Math.cos(a)*31,48+Math.sin(a)*31],[-5+Math.cos(a)*44,48+Math.sin(a)*44]],3,ink);}
  }
  if(finish.id==='gold'){
    for(let i=0;i<3;i++)line([[-66+i*9,9],[-56+i*9,-10],[-46+i*9,9],[-54+i*9,16]],2,finish.shade);
  }else if(finish.id==='crimson'){
    for(let i=0;i<2;i++)line([[55+i*5,-19+i*6],[barrelEnd-24,-21+i*6]],2,ink);
  }else if(finish.id==='ivory'){
    line([[-77,7],[-60,14],[-23,18]],3,trim);
  }
  // Receiver details, trigger guard, bolt and polished ink highlights.
  ctx.beginPath();ctx.moveTo(-9,23);ctx.quadraticCurveTo(15,34,20,51);ctx.quadraticCurveTo(12,64,-7,57);ctx.strokeStyle=ink;ctx.lineWidth=6;ctx.stroke();line([[-38,-25],[4,-27],[21,-18]],3,paper);ctx.beginPath();ctx.arc(-49,-34,6,0,Math.PI*2);ctx.fillStyle=cream;ctx.fill();ctx.strokeStyle=ink;ctx.lineWidth=3;ctx.stroke();
  // Two rubber-hose arms and stitched gloves hold the gun across the torso.
  line([[-54,17],[-77,37],[-93,41]],17,ink);line([[-54,17],[-77,37],[-93,41]],8,cream);line([[3,29],[30,49],[46,47]],17,ink);line([[3,29],[30,49],[46,47]],8,cream);glove(-101,40,.74);glove(51,46,.72);
  if(flash){ctx.save();ctx.translate(barrelEnd+18,-15);ctx.fillStyle=finish.id==='standard'?paper:finish.flash;ctx.strokeStyle=ink;ctx.lineWidth=5;ctx.beginPath();for(let i=0;i<16;i++){const a=i*Math.PI/8,r=i%2?18:44;const x=Math.cos(a)*r,y=Math.sin(a)*r;ctx[i?'lineTo':'moveTo'](x,y);}ctx.closePath();ctx.fill();ctx.stroke();ctx.font='900 17px Georgia';ctx.textAlign='center';ctx.fillStyle=ink;ctx.fillText(action.label||'CLICK!',0,-52);ctx.restore();}
  ctx.restore();
}

export function drawRubberHoseWeapon(ctx,weapon='automatic',time=0,action={}){
  if(!ctx)return;ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);const w=ctx.canvas.width,h=ctx.canvas.height;ctx.save();ctx.translate(w/2,h*.53);ctx.scale(Math.min(w,h)/512,Math.min(w,h)/512);drawPreviewGun(ctx,weapon,time,action);ctx.restore();
}

export function drawRubberHoseCharacter(ctx,skin='slinky',time=0,weapon=null,action={}){
  const spec=rubberHoseCast.find(s=>s.id===skin)||rubberHoseCast[0],pose=Math.floor(time*12)%4,step=Math.sin(pose*Math.PI/2),blink=Math.sin(time*1.9)>.975,ink='#0b0b0d',paper='#faf6eb',mid='#686a70',cream='#e8e1cf',fit=skin==='velvet' ? .75 : skin==='kitty'||skin==='hattie' ? .84 : 1,width=ctx.canvas?.width||512,height=ctx.canvas?.height||512,canvasScale=Math.min(width/512,height/512),pop=action.pulse||0;
  ctx.clearRect(0,0,width,height);ctx.save();ctx.translate(width/2,height*.53+Math.sin(pose*Math.PI/2)*5*canvasScale);ctx.scale(canvasScale*fit*(1+pop*.045)*(1+(pose%2 ? -.018 : .012)),canvasScale*fit*(1-pop*.035)*(1+(pose%2 ? .018 : -.012)));
  const ellipse=(x,y,rx,ry,fill,stroke=ink,lw=10,rot=0)=>{ctx.beginPath();ctx.ellipse(x,y,rx,ry,rot,0,Math.PI*2);if(fill===paper||fill===cream||fill===mid){const shade=ctx.createLinearGradient(x-rx*.45,y-ry,x+rx*.2,y+ry);shade.addColorStop(0,fill===mid?'#85868a':'#fffdf4');shade.addColorStop(.62,fill);shade.addColorStop(1,fill===mid?'#4b4d53':'#c7c1b6');ctx.fillStyle=shade;}else ctx.fillStyle=fill;ctx.fill();ctx.lineJoin='round';ctx.lineCap='round';ctx.lineWidth=lw;ctx.strokeStyle=stroke;ctx.stroke();};
  const path=(draw,fill,lw=11,stroke=ink)=>{ctx.beginPath();draw(ctx);if(fill){ctx.fillStyle=fill;ctx.fill();}ctx.lineJoin='round';ctx.lineCap='round';ctx.lineWidth=lw;ctx.strokeStyle=stroke;ctx.stroke();};
  const hose=(pts,lw=20,color=ink)=>{ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);ctx.bezierCurveTo(...pts[1],...pts[2],...pts[3]);ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=lw;ctx.strokeStyle=color;ctx.stroke();};
  const shoe=(x,y,flip=1)=>{ctx.save();ctx.translate(x,y+step*(x<0?-3:3));ctx.rotate(step*(x<0?-.025:.025));ctx.scale(flip,1);path(c=>{c.moveTo(-42,0);c.quadraticCurveTo(-58,-31,-19,-32);c.quadraticCurveTo(4,-47,26,-24);c.quadraticCurveTo(55,-13,52,8);c.quadraticCurveTo(47,20,-33,16);c.closePath();},paper,10);path(c=>{c.moveTo(-37,12);c.quadraticCurveTo(2,22,47,11);},mid,5);ctx.restore();};
  const glove=(x,y,scale=1)=>{if(weapon)return;ctx.save();ctx.translate(x,y-step*2);ctx.rotate(step*.025);ctx.scale(scale,scale);path(c=>{c.moveTo(-22,6);c.bezierCurveTo(-40,-1,-28,-20,-17,-20);c.bezierCurveTo(-23,-40,-4,-42,2,-22);c.bezierCurveTo(5,-48,24,-43,22,-20);c.bezierCurveTo(39,-38,51,-22,34,-5);c.bezierCurveTo(48,13,34,29,12,27);c.bezierCurveTo(-8,30,-27,23,-22,6);c.closePath();},paper,8);ctx.strokeStyle=ink;ctx.lineWidth=4;for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(-3+i*8,3);ctx.quadraticCurveTo(4+i*8,10,7+i*8,16);ctx.stroke();}ctx.restore();};
  const pieEyes=(x=-25,y=-177,s=1)=>{if(blink){path(c=>{c.moveTo(x-23*s,y);c.quadraticCurveTo(x,y+10*s,x+22*s,y);},null,7);return;}ellipse(x,y,22*s,31*s,paper,ink,5);ctx.fillStyle=ink;ctx.beginPath();ctx.moveTo(x-9*s,y-15*s);ctx.quadraticCurveTo(x+13*s,y-8*s,x+3*s,y+18*s);ctx.quadraticCurveTo(x-8*s,y+28*s,x-9*s,y-15*s);ctx.fill();};
  // Rear limbs are inked as continuous tapered rubber hoses, with hand-drawn white gloves.
  if(skin==='slinky'){
    shoe(-112,204);shoe(111,198,-1);hose([[-9,151],[-72,172],[-71,222],[-115,204]],23);hose([[21,151],[62,176],[61,216],[111,198]],23);
    path(c=>{c.moveTo(-39,135);c.bezierCurveTo(-77,97,-32,65,13,45);c.bezierCurveTo(88,10,93,-45,26,-67);c.bezierCurveTo(-33,-91,-41,-126,-13,-161);c.lineTo(50,-145);c.bezierCurveTo(23,-115,48,-103,92,-88);c.bezierCurveTo(174,-58,134,25,48,69);c.bezierCurveTo(9,88,14,123,39,140);c.closePath();},ink,11);
    ellipse(39,-177,75,53,paper,ink,11,-.08);path(c=>{c.moveTo(-13,-170);c.bezierCurveTo(-62,-174,-94,-151,-128,-149);c.bezierCurveTo(-150,-147,-170,-159,-158,-180);c.bezierCurveTo(-145,-207,-75,-220,-20,-206);c.quadraticCurveTo(7,-195,-13,-170);c.closePath();},paper,9);ctx.strokeStyle=mid;ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-128,-184);ctx.quadraticCurveTo(-107,-203,-90,-202);ctx.moveTo(-88,-188);ctx.quadraticCurveTo(-67,-208,-51,-207);ctx.stroke();
    pieEyes(20,-190,.72);pieEyes(69,-190,.72);ellipse(90,-174,7,5,ink,ink,2);glove(-135,145,.82);
  }else if(skin==='velvet'){
    hose([[-46,90],[-96,117],[-112,147],[-87,160]],17);hose([[47,83],[96,71],[116,104],[127,119]],17);shoe(-68,204);shoe(70,204,-1);hose([[-22,123],[-24,155],[-52,181],[-69,198]],13);hose([[22,123],[24,158],[50,180],[69,198]],13);
    path(c=>{c.moveTo(-67,14);c.bezierCurveTo(-48,-17,-40,-62,-48,-95);c.quadraticCurveTo(-55,-122,-31,-135);c.lineTo(31,-135);c.quadraticCurveTo(54,-120,48,-92);c.bezierCurveTo(40,-51,52,-11,76,20);c.quadraticCurveTo(6,52,-67,14);c.closePath();},ink,11);
    path(c=>{c.moveTo(-50,-112);c.bezierCurveTo(-83,-154,-77,-217,-55,-246);c.bezierCurveTo(-34,-278,4,-251,0,-213);c.quadraticCurveTo(-1,-179,-22,-148);c.moveTo(24,-142);c.bezierCurveTo(36,-193,62,-260,91,-255);c.bezierCurveTo(121,-247,98,-177,67,-138);},paper,10);
    ellipse(0,-173,78,82,paper,ink,11);pieEyes(-28,-180,.82);pieEyes(28,-180,.82);ctx.strokeStyle=ink;ctx.lineWidth=5;for(const x of [-50,12]){ctx.beginPath();ctx.moveTo(x,-203);ctx.quadraticCurveTo(x-19,-219,x-29,-231);ctx.stroke();}
    path(c=>{c.moveTo(-10,-145);c.quadraticCurveTo(4,-135,17,-147);},null,6);path(c=>{c.moveTo(-87,126);c.quadraticCurveTo(-57,105,-33,91);},null,13);glove(130,120,1.05);glove(-84,158,.7);
  }else if(skin==='bug'){
    shoe(-72,204);shoe(76,204,-1);hose([[-39,118],[-63,151],[-73,176],[-72,194]],16);hose([[38,118],[68,150],[75,172],[76,194]],16);
    path(c=>{c.moveTo(-68,100);c.bezierCurveTo(-99,60,-94,8,-81,-21);c.quadraticCurveTo(-116,-47,-106,-92);c.bezierCurveTo(-99,-147,-55,-176,0,-177);c.bezierCurveTo(70,-178,105,-127,100,-74);c.bezierCurveTo(97,-35,77,-3,64,32);c.quadraticCurveTo(90,75,65,106);c.quadraticCurveTo(1,135,-68,100);c.closePath();},ink,12);
    hose([[-23,-168],[-44,-223],[-73,-250],[-65,-278]],12);hose([[25,-169],[50,-224],[78,-245],[70,-274]],12);ellipse(-65,-281,9,13,mid,ink,4);ellipse(70,-277,9,13,mid,ink,4);
    ellipse(35,-112,52,55,paper,ink,8);ctx.fillStyle=ink;ctx.beginPath();ctx.moveTo(37,-142);ctx.bezierCurveTo(75,-130,78,-92,49,-67);ctx.bezierCurveTo(35,-57,20,-81,24,-103);ctx.closePath();ctx.fill();ellipse(6,-89,7,5,mid,ink,2);
    path(c=>{c.moveTo(-68,27);c.quadraticCurveTo(-8,46,66,28);c.lineTo(82,105);c.quadraticCurveTo(9,132,-79,104);c.closePath();},paper,10);ctx.strokeStyle=ink;ctx.lineWidth=10;ctx.beginPath();ctx.moveTo(-39,32);ctx.lineTo(-14,67);ctx.moveTo(39,32);ctx.lineTo(16,67);ctx.stroke();
    hose([[-59,12],[-100,22],[-115,55],[-135,47]],15);if(!weapon){glove(-139,47,.72);path(c=>{c.moveTo(-147,28);c.quadraticCurveTo(-176,10,-193,23);c.quadraticCurveTo(-179,44,-193,63);c.quadraticCurveTo(-160,83,-143,57);c.closePath();},mid,7);ctx.strokeStyle=paper;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-186,28);ctx.lineTo(-164,34);ctx.stroke();}
  }else if(skin==='parsnip'){
    shoe(-61,207);shoe(64,207,-1);hose([[-28,127],[-37,156],[-50,181],[-60,198]],15);hose([[28,127],[40,157],[50,181],[63,198]],15);hose([[-62,15],[-108,27],[-110,57],[-105,70]],18);hose([[62,15],[105,26],[108,57],[104,70]],18);glove(-106,78,.82);glove(107,78,.82);
    // Broad tapered turnip body with root lobes and crosshatched cheek shadows.
    path(c=>{c.moveTo(-72,112);c.bezierCurveTo(-108,72,-79,31,-80,-18);c.quadraticCurveTo(-91,-77,-61,-126);c.quadraticCurveTo(-36,-160,0,-148);c.quadraticCurveTo(49,-158,68,-119);c.bezierCurveTo(95,-66,77,-7,82,29);c.quadraticCurveTo(84,79,48,110);c.quadraticCurveTo(1,143,-72,112);c.closePath();},paper,12);
    ctx.fillStyle=mid;for(let i=0;i<7;i++){const x=-62+i*20;path(c=>{c.moveTo(x,-129);c.bezierCurveTo(x-22,-160-i%3*13,x-18,-194-i%2*9,x-4,-219);c.bezierCurveTo(x+8,-189,x+22,-158,x+10,-127);c.closePath();},mid,6);}
    path(c=>{c.moveTo(-69,-73);c.quadraticCurveTo(-42,-92,-15,-77);c.moveTo(12,-77);c.quadraticCurveTo(43,-97,67,-73);},null,9);ctx.fillStyle=ink;ctx.beginPath();ctx.ellipse(-34,-51,13,9,-.2,0,Math.PI*2);ctx.ellipse(37,-51,13,9,.2,0,Math.PI*2);ctx.fill();
    path(c=>{c.moveTo(-73,-23);c.bezierCurveTo(-96,-1,-129,-9,-147,4);c.bezierCurveTo(-129,23,-92,28,-69,13);},paper,9);path(c=>{c.moveTo(-28,28);c.quadraticCurveTo(2,39,33,24);},null,7);ctx.strokeStyle=mid;ctx.lineWidth=3;for(let i=0;i<5;i++){ctx.beginPath();ctx.moveTo(-70+i*8,54+i*5);ctx.lineTo(-59+i*8,72+i*4);ctx.stroke();}
  }else if(skin==='kitty'){
    shoe(-72,207);shoe(78,207,-1);hose([[-38,125],[-52,163],[-67,178],[-72,197]],16);hose([[39,125],[57,161],[71,180],[78,197]],16);hose([[58,39],[118,48],[130,5],[170,-7]],14);
    path(c=>{c.moveTo(-84,-103);c.lineTo(-113,-195);c.quadraticCurveTo(-68,-170,-39,-148);c.quadraticCurveTo(0,-170,41,-149);c.lineTo(113,-194);c.lineTo(86,-91);c.bezierCurveTo(111,-35,92,22,48,51);c.quadraticCurveTo(0,82,-51,47);c.bezierCurveTo(-98,20,-107,-40,-84,-103);c.closePath();},ink,12);
    ellipse(-48,-98,29,39,mid,ink,6);ellipse(48,-98,29,39,mid,ink,6);ellipse(-17,-82,31,50,paper,ink,5);ellipse(34,-82,31,50,paper,ink,5);ctx.fillStyle=ink;ctx.beginPath();ctx.ellipse(-10,-89,10,19,-.1,0,Math.PI*2);ctx.ellipse(38,-89,10,19,.1,0,Math.PI*2);ctx.fill();
    ellipse(7,-13,61,43,paper,ink,7);ellipse(8,-31,10,7,ink,ink,2);path(c=>{c.moveTo(8,-24);c.quadraticCurveTo(-5,-6,-20,-17);c.moveTo(8,-24);c.quadraticCurveTo(22,-5,40,-16);},null,4);
    path(c=>{c.moveTo(-93,-168);c.quadraticCurveTo(-56,-214,0,-207);c.quadraticCurveTo(54,-212,94,-171);c.lineTo(49,-151);c.lineTo(-48,-151);c.closePath();},paper,10);path(c=>{c.moveTo(-59,-148);c.quadraticCurveTo(0,-137,54,-149);},null,5);
    path(c=>{c.moveTo(-68,47);c.quadraticCurveTo(0,76,70,45);c.lineTo(66,121);c.quadraticCurveTo(0,147,-68,119);c.closePath();},mid,10);path(c=>{c.moveTo(0,58);c.lineTo(-20,87);c.lineTo(1,105);c.lineTo(22,87);c.closePath();},paper,6);glove(127,0,.7);
  }else{
    shoe(-42,211);shoe(45,211,-1);hose([[-22,124],[-28,158],[-41,184],[-43,202]],14);hose([[24,124],[28,159],[41,184],[46,203]],14);
    // Feathered wings sit behind the angel's raised arms.
    for(const side of [-1,1]){ctx.save();ctx.scale(side,1);path(c=>{c.moveTo(50,-33);c.bezierCurveTo(111,-95,165,-73,159,-26);c.bezierCurveTo(150,-2,127,9,105,2);c.bezierCurveTo(93,35,71,31,57,17);c.closePath();},paper,8);for(let i=0;i<4;i++){path(c=>{c.moveTo(77+i*8,-19+i*8);c.quadraticCurveTo(112+i*5,-36+i*7,139-i*3,-27+i*9);},null,4,mid);}ctx.restore();}
    hose([[-61,28],[-104,2],[-119,-25],[-134,-29]],16);hose([[61,28],[102,3],[121,-24],[137,-24]],16);glove(-139,-28,.86);glove(142,-24,.86);
    ctx.strokeStyle=ink;ctx.lineWidth=8;ctx.beginPath();ctx.ellipse(0,-286,49,12,-.04,0,Math.PI*2);ctx.stroke();ctx.strokeStyle=paper;ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,-286,49,12,-.04,Math.PI,Math.PI*1.8);ctx.stroke();
    ellipse(0,-175,78,80,paper,ink,11);pieEyes(-27,-185,.78);pieEyes(28,-185,.78);ellipse(0,-204,7,5,ink,ink,2);
    path(c=>{c.moveTo(-42,-144);c.quadraticCurveTo(0,-124,43,-145);c.quadraticCurveTo(39,-93,0,-88);c.quadraticCurveTo(-39,-94,-42,-144);c.closePath();},paper,7);ctx.fillStyle=ink;ctx.beginPath();ctx.moveTo(-35,-139);ctx.lineTo(35,-139);ctx.lineTo(28,-111);ctx.lineTo(-27,-111);ctx.closePath();ctx.fill();ctx.strokeStyle=paper;ctx.lineWidth=3;for(let x=-19;x<=19;x+=10){ctx.beginPath();ctx.moveTo(x,-137);ctx.lineTo(x,-112);ctx.stroke();}
    path(c=>{c.moveTo(-47,15);c.quadraticCurveTo(0,36,47,14);c.lineTo(69,118);c.quadraticCurveTo(0,154,-69,118);c.closePath();},paper,10);for(let i=-2;i<=2;i++){ctx.beginPath();ctx.arc(i*21,118,17,0,Math.PI);ctx.strokeStyle=ink;ctx.lineWidth=5;ctx.stroke();}
  }
  // Cream highlights and hand-painted contour hatching finish the ink illustration.
  ctx.strokeStyle='rgba(250,246,235,.72)';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-64,-129);ctx.quadraticCurveTo(-47,-154,-27,-158);ctx.stroke();ctx.strokeStyle='rgba(11,11,13,.42)';ctx.lineWidth=2;for(let i=0;i<5;i++){ctx.beginPath();ctx.moveTo(94+i*4,74+i*5);ctx.lineTo(81+i*4,95+i*5);ctx.stroke();}
  if(weapon){ctx.save();ctx.translate(4,43);ctx.scale(.77,.77);drawPreviewGun(ctx,weapon,time,action);ctx.restore();}
  ctx.restore();
}
export function rubberHoseTexture(skin='slinky',frame=0){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;drawRubberHoseCharacter(canvas.getContext('2d'),skin,frame/12);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;return texture;}
export function goldRimTexture(source){const image=source?.image,canvas=document.createElement('canvas');canvas.width=image?.width||512;canvas.height=image?.height||512;const ctx=canvas.getContext('2d');if(image){ctx.shadowColor='#ffe89e';ctx.shadowBlur=18;ctx.drawImage(image,0,0,canvas.width,canvas.height);ctx.shadowBlur=0;ctx.globalCompositeOperation='source-in';ctx.fillStyle='#ffe89e';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.globalCompositeOperation='source-over';}const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;}

const fxTimers=new Map();
const activeFx=new Map();
export function setComicFx(name,enabled){activeFx.set(name,!!enabled);const layer=document.querySelector('#fx');if(layer)layer.classList.toggle(`fx-${name}`,enabled);if(name==='impact'||name==='hurt')document.body.classList.toggle('fx-screen-shake',enabled);}
export function triggerComicFx(name,duration=450){if(name==='impact')activeFx.set('impactAt',performance.now());setComicFx(name,true);clearTimeout(fxTimers.get(name));fxTimers.set(name,setTimeout(()=>setComicFx(name,false),duration));}
export function renderActionFx(ctx,width,height,time,player){
  if(!ctx)return;ctx.clearRect(0,0,width,height);ctx.save();ctx.scale(width/innerWidth,height/innerHeight);
  const active=n=>activeFx.get(n),w=innerWidth,h=innerHeight,cx=w/2,cy=h/2;
  // Keep the central 58% of the view clear; all action marks live on the outer frame.
  if(active('dash')||active('sprint')||active('slide')||active('slam')){
    const dash=active('dash'),sprint=active('sprint'),slide=active('slide');
    const rush=slide?THREE.MathUtils.smoothstep(Math.hypot(player.velocity.x,player.velocity.z),28,48):0;
    const chain=slide?Math.min(1,player.slideChain/4):0;
    const count=24+Math.round(chain*16), travel=dash?700:sprint?460:260+rush*270+chain*180;
    const reach=dash?54:34+rush*14+chain*15;
    const frameTime=Math.floor(time*24)/24;
    for(let i=0;i<count;i++){
      const side=i%4,edge=i%8<4?1:-1,offset=(i*47+frameTime*travel)%(Math.min(w,h)*.48);
      const x=side<2?(side===0?12:w-12):cx+edge*offset;
      const y=side<2?cy+edge*offset:(side===2?12:h-12);
      const dx=side<2?(side===0?1:-1)*reach:edge*22;
      const dy=side<2?edge*26:(side===2?1:-1)*reach*.85;
      ctx.beginPath();
      ctx.moveTo(x,y);
      ctx.quadraticCurveTo(x+dx*.48,y+dy*.42+Math.sin(i*2)*9,x+dx,y+dy);
      ctx.globalAlpha=dash?.68:slide?.30+.24*rush+.14*chain:sprint?.30:.22;
      ctx.strokeStyle='#18161a';
      ctx.lineWidth=dash?4.3:2.9+chain*1.4;
      ctx.stroke();
      ctx.strokeStyle='#e8e1cf';
      ctx.lineWidth=dash?2.2:1+chain*.55;
      ctx.stroke();
    }
  }
  if(active('bullet')){ctx.fillStyle='rgba(11,11,13,.14)';ctx.fillRect(0,0,w,h);const pulse=(Math.sin(time*6)+1)*.5;ctx.strokeStyle=`rgba(232,225,207,${.12+pulse*.12})`;ctx.lineWidth=2;for(const s of [0,1]){ctx.beginPath();ctx.ellipse(cx,cy,Math.min(w,h)*(.46+s*.025+pulse*.008),Math.min(w,h)*(.46+s*.025+pulse*.008),0,0,Math.PI*2);ctx.stroke();}}
  if(active('grapple')){const a=.09+.035*Math.sin(time*11);ctx.strokeStyle=`rgba(232,225,207,${a})`;ctx.lineWidth=12;ctx.strokeRect(12,12,w-24,h-24);}
  if(active('hurt')){const gradient=ctx.createRadialGradient(cx,cy,Math.min(w,h)*.18,cx,cy,Math.max(w,h)*.72);gradient.addColorStop(0,'rgba(90,10,10,0)');gradient.addColorStop(1,'rgba(90,10,10,.45)');ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);}
  if(active('impact')){const pulse=Math.max(0,1-((performance.now()-(activeFx.get('impactAt')||performance.now()))/500));ctx.strokeStyle=`rgba(250,246,235,${pulse*.55})`;ctx.lineWidth=8*pulse;ctx.beginPath();ctx.arc(cx,cy,Math.min(w,h)*(.08+(1-pulse)*.8),0,Math.PI*2);ctx.stroke();}
  // A tiny warm fluctuation suggests a flickering projector bulb without
  // lowering contrast or obscuring the center of the view.
  ctx.fillStyle=`rgba(255,226,177,${.004+(.003*(.5+.5*Math.sin(time*8.7)))})`;ctx.fillRect(0,0,w,h);
  ctx.restore();
}

let dustMap;
export function inkDust(scene,position,intensity=1){
  if(!dustMap){const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d'),g=x.createRadialGradient(32,32,2,32,32,31);g.addColorStop(0,'rgba(34,35,40,.46)');g.addColorStop(.48,'rgba(34,35,40,.23)');g.addColorStop(1,'rgba(34,35,40,0)');x.fillStyle=g;x.fillRect(0,0,64,64);dustMap=new THREE.CanvasTexture(c);}
  const motes=[];for(let i=0;i<4;i++){const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:dustMap,color:i%2?0x686a70:0x222328,transparent:true,opacity:.32,depthWrite:false}));sprite.position.copy(position);sprite.position.x+=(Math.random()-.5)*.55;sprite.position.z+=(Math.random()-.5)*.55;sprite.position.y+=.06+i*.015;sprite.scale.setScalar((.22+Math.random()*.2)*intensity);scene.add(sprite);motes.push({sprite,dx:(Math.random()-.5)*.55,dy:.12+Math.random()*.12,dz:(Math.random()-.5)*.55,scale:sprite.scale.x});}
  const start=performance.now(),tick=()=>{const t=(performance.now()-start)/440;if(t>=1){for(const {sprite} of motes){scene.remove(sprite);sprite.material.dispose();}return;}for(const m of motes){m.sprite.position.x+=m.dx/60;m.sprite.position.y+=m.dy/60;m.sprite.position.z+=m.dz/60;m.sprite.scale.setScalar(m.scale*(1+t*1.5));m.sprite.material.opacity=.32*(1-t);}requestAnimationFrame(tick);};requestAnimationFrame(tick);
}
