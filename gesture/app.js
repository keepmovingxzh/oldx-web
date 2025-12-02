// --- 旗舰版配置 ---
const CONFIG = {
    photoCount: 8,         
    photoPath: 'photo/',
    // 粒子配置
    treeParticles: 65000,   
    outlineParticles: 20000,
    treeHeight: 1100,       
    baseRadius: 480,        
    // 视觉配置
    bloomStrength: 1.4,     
    bloomThreshold: 0.15,
    triggerHoldTime: 400,   
    colors: {
        leafDark: new THREE.Color('#001a00'), 
        leafLight: new THREE.Color('#00ff44'), 
        outline: new THREE.Color('#aaffaa'),   
        star: 0xffd700,
        dust: 0xff00ff,
        trunkDark: new THREE.Color('#5d4037'),
        trunkLight: new THREE.Color('#8d6e63')
    }
};

// --- 状态机 ---
let state = {
    mode: 'tree', 
    isTransitioning: false,
    activePhoto: null,    
    originalParent: null, 
    gestureHoldStart: 0,
    currentGesture: 'none',
    isPaused: false
};

// --- 全局变量 ---
let scene, camera, renderer, composer;
let treeGroup = new THREE.Group(); 
let decorationGroup = new THREE.Group(); 
let galaxyGroup = new THREE.Group(); 
let magicGroup = new THREE.Group(); 
let photoMeshList = []; 
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2(-100, -100);
let clock = new THREE.Clock();

// 粒子系统引用
let leafSystem, outlineSystem, trunkSystem, lightSystem, snowSystem, dustSystem, magicSystem;

// DOM
let debugCanvas, debugCtx, statusEl, cursorEl, instructionEl;

window.addEventListener('DOMContentLoaded', init);

function init() {
    debugCanvas = document.getElementById('debug-canvas');
    debugCtx = debugCanvas.getContext('2d');
    statusEl = document.getElementById('hand-status');
    cursorEl = document.getElementById('cursor');
    instructionEl = document.querySelector('.hud-instruction') || document.createElement('div'); 

    initThree();
    initPostProcessing();
    initMediaPipe();
    animate();
}

// --- 纹理辅助 ---
function createSoftParticleTexture() {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(16,16,0, 16,16,16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.2)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,32,32);
    return new THREE.CanvasTexture(c);
}

function createSparkleTexture() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32,32,0, 32,32,32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,64,64);
    ctx.fillStyle = 'white';
    ctx.fillRect(28, 0, 8, 64); 
    ctx.fillRect(0, 28, 64, 8); 
    return new THREE.CanvasTexture(c);
}

function createPlaceholder(i) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#080808'; 
    ctx.fillRect(0,0,512,512);
    ctx.fillStyle = '#ccc';
    ctx.font = 'bold 100px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${i}`, 256, 256);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 20;
    ctx.strokeRect(20,20,472,472);
    return new THREE.CanvasTexture(c);
}

function initThree() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.0004);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 10000);
    camera.position.set(0, 150, 1800);

    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 1.3;
    document.body.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.5); 
    scene.add(ambient);
    
    const coreLight = new THREE.PointLight(0x00ff44, 1.5, 1000);
    coreLight.position.set(0, CONFIG.treeHeight/3, 0);
    scene.add(coreLight);

    treeGroup.position.y = 100;
    decorationGroup.position.y = 100;

    // 构建场景
    createParticleTrunk();  
    createLayeredTree();    
    createParticleLights(); 
    createSnow();           
    createGalaxyDust(); 
    createStardustMagic(); 
    addDecorations();       

    scene.add(galaxyGroup);
    scene.add(magicGroup);
    scene.add(treeGroup);
    scene.add(decorationGroup);

    const loaderEl = document.getElementById('loading');
    if (loaderEl) {
        setTimeout(() => {
            loaderEl.style.opacity = 0;
            setTimeout(() => loaderEl.style.display = 'none', 1500);
        }, 1500);
    }
}

function initPostProcessing() {
    const renderScene = new THREE.RenderPass(scene, camera);
    const bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        CONFIG.bloomStrength, 0.5, CONFIG.bloomThreshold
    );
    composer = new THREE.EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
}

// --- 1. 粒子树干 ---
function createParticleTrunk() {
    const geo = new THREE.BufferGeometry();
    const pos = [];
    const col = [];
    const c1 = CONFIG.colors.trunkDark;
    const c2 = CONFIG.colors.trunkLight;
    const tempC = new THREE.Color();

    const count = 12000; 
    const trunkHeight = CONFIG.treeHeight * 0.4; 
    const startY = -CONFIG.treeHeight/2 - 80; 

    for(let i=0; i<count; i++) {
        const h = Math.random() * trunkHeight;
        const angle = Math.random() * Math.PI * 2;
        const r = Math.pow(Math.random(), 0.5) * 60; 
        
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        const y = startY + h;

        pos.push(x, y, z);

        tempC.lerpColors(c1, c2, Math.random());
        col.push(tempC.r, tempC.g, tempC.b);
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));

    const mat = new THREE.PointsMaterial({
        size: 5, vertexColors: true, map: createSoftParticleTexture(),
        transparent: true, opacity: 1.0, depthWrite: true
    });

    trunkSystem = new THREE.Points(geo, mat);
    treeGroup.add(trunkSystem);
}

// --- 2. 层级树叶 ---
function createLayeredTree() {
    const geoLeaf = new THREE.BufferGeometry();
    const posLeaf = [];
    const colLeaf = [];
    const particleColor = new THREE.Color();

    const geoOutline = new THREE.BufferGeometry();
    const posOutline = [];
    const colOutline = [];

    const layers = 14; 
    const layerHeight = CONFIG.treeHeight / layers;

    for (let i = 0; i < CONFIG.treeParticles; i++) {
        const layerIndex = Math.floor(Math.pow(Math.random(), 0.8) * layers); 
        const layerBaseY = -CONFIG.treeHeight/2 + layerIndex * layerHeight;
        const yOffset = Math.random() * layerHeight;
        const y = layerBaseY + yOffset;

        const progress = (layerIndex + yOffset/layerHeight) / layers;
        const maxR = (1 - progress * 0.95) * CONFIG.baseRadius; 

        const r = Math.pow(Math.random(), 0.5) * maxR;
        const angle = Math.random() * Math.PI * 2;
        const droop = (r / maxR) * (layerHeight * 0.6);
        
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        
        posLeaf.push(x, y - droop, z);

        const mix = (r / maxR);
        particleColor.lerpColors(CONFIG.colors.leafDark, CONFIG.colors.leafLight, mix);
        colLeaf.push(particleColor.r, particleColor.g, particleColor.b);
    }

    for (let i = 0; i < CONFIG.outlineParticles; i++) {
        const layerIndex = Math.floor(Math.random() * layers);
        const layerBaseY = -CONFIG.treeHeight/2 + layerIndex * layerHeight;
        const yOffset = Math.random() * layerHeight * 0.2; 
        
        const progress = layerIndex / layers;
        const maxR = (1 - progress * 0.95) * CONFIG.baseRadius;
        
        const r = maxR * (0.98 + Math.random() * 0.05);
        const angle = Math.random() * Math.PI * 2;
        
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        const y = layerBaseY + yOffset - (layerHeight * 0.5); 

        posOutline.push(x, y, z);
        colOutline.push(CONFIG.colors.outline.r, CONFIG.colors.outline.g, CONFIG.colors.outline.b);
    }

    geoLeaf.setAttribute('position', new THREE.Float32BufferAttribute(posLeaf, 3));
    geoLeaf.setAttribute('color', new THREE.Float32BufferAttribute(colLeaf, 3));
    const matLeaf = new THREE.PointsMaterial({
        size: 5, vertexColors: true, map: createSoftParticleTexture(),
        transparent: true, opacity: 0.9, blending: THREE.NormalBlending, depthWrite: false
    });
    leafSystem = new THREE.Points(geoLeaf, matLeaf);
    treeGroup.add(leafSystem);

    geoOutline.setAttribute('position', new THREE.Float32BufferAttribute(posOutline, 3));
    geoOutline.setAttribute('color', new THREE.Float32BufferAttribute(colOutline, 3));
    const matOutline = new THREE.PointsMaterial({
        size: 3, vertexColors: true, blending: THREE.AdditiveBlending,
        transparent: true, opacity: 0.7, depthWrite: false
    });
    outlineSystem = new THREE.Points(geoOutline, matOutline);
    treeGroup.add(outlineSystem);

    const starGeo = new THREE.OctahedronGeometry(55, 0);
    const starMat = new THREE.MeshBasicMaterial({ color: CONFIG.colors.star });
    const star = new THREE.Mesh(starGeo, starMat);
    star.position.y = CONFIG.treeHeight/2 + 60;
    treeGroup.add(star);
    treeGroup.add(new THREE.PointLight(CONFIG.colors.star, 2, 800));
}

// --- 3. 粒子彩灯 ---
function createParticleLights() {
    const geo = new THREE.BufferGeometry();
    const pos = [];
    const col = [];
    const tempC = new THREE.Color();

    const count = 800; 
    for(let i=0; i<count; i++) {
        const t = i / count;
        const h = (t - 0.5) * CONFIG.treeHeight * 0.95;
        const maxR = (1 - (h + CONFIG.treeHeight/2)/CONFIG.treeHeight) * CONFIG.baseRadius;
        const r = maxR + 30; 
        
        const angle = t * Math.PI * 20 + (i%2)*Math.PI;

        pos.push(Math.cos(angle)*r, h, Math.sin(angle)*r);

        const rnd = Math.random();
        if(rnd<0.2) tempC.setHex(0xff0000); 
        else if(rnd<0.4) tempC.setHex(0xffd700); 
        else if(rnd<0.6) tempC.setHex(0x0044ff); 
        else if(rnd<0.8) tempC.setHex(0xff00ff); 
        else tempC.setHex(0x00ffcc); 
        
        col.push(tempC.r, tempC.g, tempC.b);
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
        size: 12, vertexColors: true, map: createSoftParticleTexture(),
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    });
    lightSystem = new THREE.Points(geo, mat);
    treeGroup.add(lightSystem);
}

// --- 4. 宇宙星尘 ---
function createGalaxyDust() {
    const count = 5000;
    const geo = new THREE.BufferGeometry();
    const pos = [];
    const col = [];
    const c1 = new THREE.Color(0x8800ff); 
    const c2 = new THREE.Color(0xffaa00); 
    const tC = new THREE.Color();

    for(let i=0; i<count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = 1000 + Math.random() * 1500;
        const y = (Math.random() - 0.5) * 1000;
        pos.push(Math.cos(angle)*r, y, Math.sin(angle)*r);
        tC.lerpColors(c1, c2, Math.random());
        col.push(tC.r, tC.g, tC.b);
    }
    
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    
    const mat = new THREE.PointsMaterial({
        size: 4, vertexColors: true, blending: THREE.AdditiveBlending,
        transparent: true, opacity: 0
    });
    
    dustSystem = new THREE.Points(geo, mat);
    galaxyGroup.add(dustSystem);
}

// --- 5. 魔法闪烁特效 ---
function createStardustMagic() {
    const count = 2000;
    const geo = new THREE.BufferGeometry();
    const pos = [];
    const col = [];
    const sizes = [];
    const phases = []; 
    
    const c1 = new THREE.Color(0x00ffff); 
    const c2 = new THREE.Color(0xff0088); 
    const tC = new THREE.Color();

    for(let i=0; i<count; i++) {
        const r = 800 + Math.random() * 2000;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);
        
        pos.push(x, y, z);
        tC.lerpColors(c1, c2, Math.random());
        col.push(tC.r, tC.g, tC.b);
        
        sizes.push(Math.random() * 15); 
        phases.push(Math.random() * Math.PI * 2);
    }
    
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    geo.setAttribute('phase', new THREE.Float32BufferAttribute(phases, 1));
    
    const mat = new THREE.PointsMaterial({
        vertexColors: true, map: createSparkleTexture(), blending: THREE.AdditiveBlending,
        transparent: true, opacity: 0, depthWrite: false
    });
    
    magicSystem = new THREE.Points(geo, mat);
    magicGroup.add(magicSystem);
}

// --- 6. 装饰照片 (尺寸升级) ---
function addDecorations() {
    const loader = new THREE.TextureLoader();
    // === 升级点：尺寸增大约 60% ===
    const frameGeo = new THREE.PlaneGeometry(130, 150); 
    const photoGeo = new THREE.PlaneGeometry(110, 110); 

    for (let i = 1; i <= CONFIG.photoCount; i++) {
        const group = new THREE.Group();
        
        const photoMat = new THREE.MeshStandardMaterial({ 
            side: THREE.DoubleSide,
            color: 0xffffff, 
            roughness: 0.5,  
            metalness: 0.0,  
            emissive: 0x000000 
        });

        const path = `${CONFIG.photoPath}${i}`;
        const onLoad = (tex) => {
            tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); 
            tex.encoding = THREE.sRGBEncoding; 
            photoMat.map = tex; 
            photoMat.needsUpdate = true; 
        };
        loader.load(path + '.jpg', onLoad, undefined, () => {
            loader.load(path + '.png', onLoad, undefined, () => {
                photoMat.map = createPlaceholder(i); photoMat.needsUpdate = true; 
            });
        });

        const photoMesh = new THREE.Mesh(photoGeo, photoMat);
        photoMesh.position.set(0, 10, 1); // 稍微上移一点以居中
        group.add(photoMesh);

        const frameMat = new THREE.MeshStandardMaterial({ 
            color: 0xeeeeee, emissive: 0x222222, 
            roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide 
        });
        const frameMesh = new THREE.Mesh(frameGeo, frameMat);
        group.add(frameMesh);

        const hProb = Math.random(); 
        const h = (hProb - 0.5) * CONFIG.treeHeight * 0.85;
        const maxR = (1 - (h + CONFIG.treeHeight/2)/CONFIG.treeHeight) * CONFIG.baseRadius;
        
        // 半径推得更远一点，防止大照片穿模
        const r = maxR + 80; 

        const angle = Math.random() * Math.PI * 2;
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        
        const rotY = -angle + Math.PI/2; 

        const treePos = { 
            x, y: h, z, 
            rotX: -0.2 + (Math.random()-0.5)*0.4, 
            rotY: rotY + (Math.random()-0.5)*0.6, 
            rotZ: (Math.random()-0.5)*0.4 
        };
        
        const uniPos = { 
            x: (Math.random()-0.5) * 3000,
            y: (Math.random()-0.5) * 1500,
            z: (Math.random()-0.5) * 1500,
            rotX: Math.random() * Math.PI,
            rotY: Math.random() * Math.PI,
            rotZ: Math.random() * Math.PI
        };

        group.userData = { id: i, treePos, uniPos, isPhoto: true }; 
        group.position.set(treePos.x, treePos.y, treePos.z);
        group.rotation.set(treePos.rotX, treePos.rotY, treePos.rotZ);

        decorationGroup.add(group);
        photoMeshList.push(group); 
    }
}

// --- 7. 雪花 ---
function createSnow() {
    const count = 3000;
    const geo = new THREE.BufferGeometry();
    const pos = [];
    const vels = []; 
    for(let i=0; i<count; i++) {
        pos.push((Math.random()-0.5)*3000, Math.random()*2000 - 1000, (Math.random()-0.5)*3000);
        vels.push(0, - (Math.random()*2 + 1), 0); 
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.userData = { velocities: vels };
    const mat = new THREE.PointsMaterial({
        size: 6, color: 0xffffff, transparent: true, opacity: 0.8,
        map: createSoftParticleTexture(), blending: THREE.AdditiveBlending
    });
    snowSystem = new THREE.Points(geo, mat);
    scene.add(snowSystem);
}

function updateSnow() {
    if(!snowSystem) return;
    const pos = snowSystem.geometry.attributes.position.array;
    const vels = snowSystem.geometry.userData.velocities;
    for(let i=1; i<pos.length; i+=3) {
        pos[i] += vels[i]; 
        if(pos[i] < -1000) pos[i] = 1000;
    }
    snowSystem.geometry.attributes.position.needsUpdate = true;
}

// --- 模式切换 ---
function switchMode(newMode) {
    if (state.mode === newMode || state.isTransitioning) return;
    state.mode = newMode;
    state.isTransitioning = true;

    if (newMode === 'universe') {
        if(instructionEl) instructionEl.innerText = "POINT TO ZOOM | FIST TO RETURN";
        
        new TWEEN.Tween(trunkSystem.material).to({opacity: 0}, 1500).start();

        new TWEEN.Tween(treeGroup.scale).to({x:3, y:3, z:3}, 2000).easing(TWEEN.Easing.Exponential.Out).start();
        new TWEEN.Tween(treeGroup.rotation).to({y: treeGroup.rotation.y + 0.5}, 2000).start();
        new TWEEN.Tween(leafSystem.material).to({opacity: 0.1}, 2000).start();
        new TWEEN.Tween(outlineSystem.material).to({opacity: 0}, 1500).start();
        new TWEEN.Tween(dustSystem.material).to({opacity: 0.6}, 2000).start();
        new TWEEN.Tween(magicSystem.material).to({opacity: 0.8}, 2500).start();

        decorationGroup.children.forEach(obj => {
            if (obj.userData.uniPos) {
                new TWEEN.Tween(obj.position).to(obj.userData.uniPos, 2000).easing(TWEEN.Easing.Exponential.Out).delay(Math.random()*300).start();
                const dr = obj.userData.uniPos;
                if(dr.rotX!==undefined) new TWEEN.Tween(obj.rotation).to({x:dr.rotX, y:dr.rotY, z:dr.rotZ}, 2000).start();
            }
        });

    } else {
        if(instructionEl) instructionEl.innerText = "OPEN HAND TO EXPLODE";
        if (state.activePhoto) resetActivePhoto();

        new TWEEN.Tween(trunkSystem.material).to({opacity: 1}, 1500).start();

        new TWEEN.Tween(treeGroup.scale).to({x:1, y:1, z:1}, 1500).easing(TWEEN.Easing.Back.Out).start();
        new TWEEN.Tween(leafSystem.material).to({opacity: 0.9}, 1500).start();
        new TWEEN.Tween(outlineSystem.material).to({opacity: 0.7}, 1500).start();
        new TWEEN.Tween(dustSystem.material).to({opacity: 0}, 1500).start();
        new TWEEN.Tween(magicSystem.material).to({opacity: 0}, 1500).start();

        decorationGroup.children.forEach(obj => {
            if (obj.userData.treePos) {
                new TWEEN.Tween(obj.position).to(obj.userData.treePos, 1500).easing(TWEEN.Easing.Cubic.InOut).start();
                const dr = obj.userData.treePos;
                new TWEEN.Tween(obj.rotation).to({x:dr.rotX, y:dr.rotY, z:dr.rotZ}, 1500).start();
            }
        });
    }

    setTimeout(() => state.isTransitioning = false, 2100);
}

// --- 交互 ---
function checkInteraction() {
    if (state.mode !== 'universe' || state.isTransitioning) return;
    if (state.currentGesture !== 'point') {
        cursorEl.classList.remove('active');
        return;
    }

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(photoMeshList, true); 

    if (intersects.length > 0) {
        let target = intersects[0].object;
        while(target.parent && target.parent !== decorationGroup && target.parent !== scene) target = target.parent;
        
        if (target.userData.isPhoto) {
            cursorEl.classList.add('active');
            
            if (state.activePhoto !== target) {
                if (state.activePhoto) resetActivePhoto();
                state.activePhoto = target;
                state.isPaused = true;

                state.originalParent = target.parent;
                target.updateWorldMatrix(true, true); 
                scene.attach(target); 

                const dist = 350; 
                const targetPos = new THREE.Vector3(0, 0, -dist);
                targetPos.applyQuaternion(camera.quaternion);
                targetPos.add(camera.position);
                
                const targetRot = camera.quaternion.clone();

                new TWEEN.Tween(target.position).to(targetPos, 600).easing(TWEEN.Easing.Back.Out).start();
                
                const startQ = target.quaternion.clone();
                new TWEEN.Tween({t:0}).to({t:1}, 600).onUpdate(o => {
                    target.quaternion.slerpQuaternions(startQ, targetRot, o.t);
                }).start();

                // 倍数保持3.0，因为初始尺寸已经大了
                new TWEEN.Tween(target.scale).to({x: 1.8, y: 1.8, z: 1.8}, 600).start();
            }
        }
    } else {
        cursorEl.classList.remove('active');
    }
}

function resetActivePhoto() {
    if (!state.activePhoto) return;
    const p = state.activePhoto;
    const originalParent = state.originalParent || decorationGroup;

    originalParent.attach(p); 
    
    const dest = p.userData.uniPos;
    new TWEEN.Tween(p.position).to(dest, 500).start();
    new TWEEN.Tween(p.scale).to({x: 1, y: 1, z: 1}, 500).onComplete(() => {
        state.isPaused = false;
    }).start();
    
    new TWEEN.Tween(p.rotation).to({
        x: dest.rotX, y: dest.rotY, z: dest.rotZ
    }, 500).start();

    state.activePhoto = null;
    state.originalParent = null;
}

// --- 视觉识别 ---
function initMediaPipe() {
    const video = document.getElementById('input_video');
    const hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
    hands.setOptions({maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.7});
    hands.onResults(onHandResults);
    const cam = new Camera(video, { onFrame: async () => { await hands.send({image: video}); }, width: 640, height: 480 });
    cam.start();
}

function onHandResults(results) {
    debugCtx.clearRect(0, 0, 320, 240);
    debugCtx.drawImage(results.image, 0, 0, 320, 240);

    if (results.multiHandLandmarks.length > 0) {
        const lm = results.multiHandLandmarks[0];
        drawConnectors(debugCtx, lm, HAND_CONNECTIONS, {color: '#00ffcc', lineWidth: 2});

        const wrist = lm[0];
        const isFolded = (tipIdx) => {
            const tip = lm[tipIdx];
            const pip = lm[tipIdx-2]; 
            const distTip = Math.hypot(tip.x-wrist.x, tip.y-wrist.y);
            const distPip = Math.hypot(pip.x-wrist.x, pip.y-wrist.y);
            return distTip < distPip; 
        };
        const isExtended = (tipIdx) => !isFolded(tipIdx);

        const isFist = isFolded(8) && isFolded(12) && isFolded(16) && isFolded(20);
        const isOpen = isExtended(4) && isExtended(8) && isExtended(12) && isExtended(16) && isExtended(20);
        const isPoint = isExtended(8) && isFolded(12) && isFolded(16) && isFolded(20);

        let g = 'none';
        if (isOpen) g = 'open';
        else if (isFist) g = 'fist';
        else if (isPoint) g = 'point';

        if (g === state.currentGesture) {
            if (Date.now() - state.gestureHoldStart > CONFIG.triggerHoldTime) {
                if (g === 'fist') {
                    if (state.activePhoto) {
                        resetActivePhoto();
                        state.gestureHoldStart = Date.now(); 
                    } else {
                        switchMode('tree');
                    }
                } 
                else if (g === 'open') {
                    switchMode('universe');
                }
            }
        } else {
            state.currentGesture = g;
            state.gestureHoldStart = Date.now();
        }

        statusEl.innerText = g.toUpperCase();

        if (g === 'point') {
            mouse.x = ((1 - lm[8].x) * 2) - 1;
            mouse.y = -(lm[8].y * 2) + 1;
            cursorEl.style.left = ((1 - lm[8].x) * 100) + '%';
            cursorEl.style.top = (lm[8].y * 100) + '%';
            cursorEl.style.display = 'block';
        } else {
            cursorEl.style.display = 'none';
            mouse.set(-100, -100);
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    TWEEN.update();
    const time = Date.now() * 0.001;

    if (scene) {
        if (!state.isPaused) {
            if (state.mode === 'tree' && !state.isTransitioning) {
                treeGroup.rotation.y += 0.002;
                decorationGroup.rotation.y += 0.002;
            } else if (state.mode === 'universe') {
                treeGroup.rotation.y += 0.0005;
                galaxyGroup.rotation.y -= 0.0002; 
                magicGroup.rotation.y += 0.0003; 
                photoMeshList.forEach(group => {
                    if (group !== state.activePhoto) {
                        group.lookAt(camera.position);
                    }
                });
            }
        }
        
        if(lightSystem) {
            lightSystem.material.opacity = 0.6 + Math.sin(time*3)*0.4;
            lightSystem.rotation.y -= 0.005;
        }
        
        if(magicSystem && state.mode === 'universe') {
            magicSystem.material.size = 15 + Math.sin(time*2)*5;
        }
    }
    
    updateSnow();
    checkInteraction();
    composer.render();
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});