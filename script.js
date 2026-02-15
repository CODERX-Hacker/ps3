import * as THREE from 'three';

let scene, camera, renderer, particleSystem;
let time = 0;
const state = { 
    shape: 0, 
    zoomDist: 35,
    targetZoom: 35
};
let targetShape = 0;
let lastFrameTime = 0;
let isCameraRunning = false;

initThree();
animate();
startProtectedCamera();

document.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        setShape(parseInt(e.target.dataset.shape));
    });
});

function setShape(id) {
    if (targetShape !== id) {
        targetShape = id;
        document.querySelectorAll('.action-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`b${id}`).classList.add('active');
        state.zoomDist = 80; 
    }
}

async function startProtectedCamera() {
    const video = document.getElementById('video');
    const status = document.getElementById('status-text');
    const dot = document.getElementById('dot');
    const canvas = document.getElementById('output-canvas');
    const ctx = canvas.getContext('2d');

    status.innerText = "Initializing AI...";
    
    let hands;
    try {
        hands = new window.Hands({locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`});
        hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        hands.onResults(res => {
            lastFrameTime = Date.now(); 
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(res.image, 0, 0, canvas.width, canvas.height);

            if (res.multiHandLandmarks.length > 0) {
                dot.style.background = "#00ff88";
                dot.style.boxShadow = "0 0 10px #00ff88";
                status.innerText = "Tracking Active";
                status.style.color = "#00ff88";
                
                try {
                    updateLogicSafely(res.multiHandLandmarks[0]);
                } catch (logicError) {
                    console.warn("Math error avoided", logicError);
                }

                drawConnectors(ctx, res.multiHandLandmarks[0], HAND_CONNECTIONS, {color: '#00ff88', lineWidth: 2});
                drawLandmarks(ctx, res.multiHandLandmarks[0], {color: '#ffffff', lineWidth: 1, radius: 3});
            } else {
                dot.style.background = "red";
                dot.style.boxShadow = "0 0 5px red";
                status.innerText = "Show Hand";
                status.style.color = "#ffff00";
            }
        });
    } catch (e) {
        console.error("AI Load Failed", e);
        return;
    }

    async function startStream() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: { ideal: 640 }, height: { ideal: 480 } } 
            });
            video.srcObject = stream;
            await video.play();
            isCameraRunning = true;
            loop();
        } catch (e) {
            console.error("Camera denied/failed", e);
            status.innerText = "Camera Failed";
            status.style.color = "red";
            isCameraRunning = false;
        }
    }

    async function loop() {
        if (!isCameraRunning) return;
        
        if (video.readyState >= 2) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            try {
                await hands.send({image: video});
            } catch (err) {
                console.warn("Frame skipped");
            }
        }
        requestAnimationFrame(loop);
    }

    startStream();

    setInterval(() => {
        const now = Date.now();
        if (now - lastFrameTime > 2000) { 
            console.log("Watchdog: Restarting camera...");
            status.innerText = "Recovering...";
            isCameraRunning = false;
            startStream();
        }
    }, 2000);
}

function updateLogicSafely(lm) {
    const handSize = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y);
    
    if (handSize < 0.05) return;

    const rawPinch = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
    const normPinch = rawPinch / handSize;

    if (!isFinite(normPinch)) return;

    const targetZ = THREE.MathUtils.mapLinear(normPinch, 0.2, 0.7, 60, 15);
    state.targetZoom = THREE.MathUtils.clamp(targetZ, 10, 80);

    const handX = 1.0 - lm[9].x;
    const targetRot = (handX - 0.5) * 3.0;
    
    if (isFinite(targetRot)) {
        scene.rotation.y += (targetRot - scene.rotation.y) * 0.1;
    }

    const isOpen = (tip, pip) => lm[tip].y < lm[pip].y;
    const i=isOpen(8,6), m=isOpen(12,10), r=isOpen(16,14), p=isOpen(20,18);

    if(!i && !m && !r && !p) setShape(2);
    else if(i && m && r && p) setShape(0);
    else if(i && m && !r && !p) setShape(3);
    else if(i && p && !m && !r) setShape(1);
}

function initThree() {
    const container = document.getElementById('canvas-container');
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
    camera.position.z = 35;

    renderer = new THREE.WebGLRenderer({ 
        antialias: true, 
        alpha: true,
        powerPreference: "high-performance"
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    createParticles();
}

function createParticles() {
    const count = 40000;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const rand = new Float32Array(count * 3);

    for(let i=0; i<count; i++) {
        pos[i*3]=0; pos[i*3+1]=0; pos[i*3+2]=0;
        rand[i*3]=Math.random(); 
        rand[i*3+1]=Math.random(); 
        rand[i*3+2]=Math.random();
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 3));

    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uShape: { value: 0 }
        },
        vertexShader: `
            uniform float uTime;
            uniform float uShape;
            attribute vec3 aRand;
            varying vec3 vColor;
            #define PI 3.14159

            vec3 getPos(float id, float u, float v, float r) {
                vec3 p = vec3(0.0);
                float t = u * PI * 2.0;
                float phi = v * PI;

                if(id < 0.5) {
                    p = vec3(r*sin(phi)*cos(t), r*sin(phi)*sin(t), r*cos(phi));
                } else if(id < 1.5) {
                    p.x = 16.0 * pow(sin(t), 3.0);
                    p.y = 13.0 * cos(t) - 5.0 * cos(2.0*t) - 2.0 * cos(3.0*t) - cos(4.0*t);
                    p.z = (v - 0.5) * 5.0;
                    p *= 0.6; p.y += 2.0;
                } else if(id < 2.5) {
                     if(aRand.x < 0.35) {
                        float pr = 7.0; p = vec3(pr*sin(phi)*cos(t), pr*sin(phi)*sin(t), pr*cos(phi));
                    } else {
                        float dist = 11.0 + aRand.z * 11.0;
                        p = vec3(cos(t)*dist, (aRand.y-0.5)*0.5, sin(t)*dist);
                    }
                    float c=cos(0.5), s=sin(0.5);
                    p.yz = vec2(p.y*c - p.z*s, p.y*s + p.z*c);
                } else {
                    float pt = 10.0 + 5.0 * sin(5.0*t) * sin(5.0*phi);
                    p = vec3(pt*sin(phi)*cos(t), pt*sin(phi)*sin(t), pt*cos(phi));
                }
                return p;
            }

            void main() {
                float u = aRand.x; float v = aRand.y; float r = 10.0 + aRand.z * 5.0;
                vec3 p1, p2;
                float s = uShape;
                
                if(s < 1.0) { p1=getPos(0.0,u,v,r); p2=getPos(1.0,u,v,r); }
                else if(s < 2.0) { p1=getPos(1.0,u,v,r); p2=getPos(2.0,u,v,r); s-=1.0; }
                else { p1=getPos(2.0,u,v,r); p2=getPos(3.0,u,v,r); s-=2.0; }
                
                vec3 pos = mix(p1, p2, smoothstep(0.0, 1.0, s));
                pos.x += sin(uTime * 0.5 + pos.y * 0.2) * 0.2;

                vec4 mv = modelViewMatrix * vec4(pos, 1.0);
                gl_Position = projectionMatrix * mv;
                gl_PointSize = (3.0) * (40.0 / -mv.z);
                
                float hue = fract(uTime * 0.05 + pos.x * 0.02);
                vColor = 0.5 + 0.5 * cos(6.28 * (vec3(hue) + vec3(0.0, 0.33, 0.67)));
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            void main() {
                float d = distance(gl_PointCoord, vec2(0.5));
                if(d > 0.5) discard;
                gl_FragColor = vec4(vColor, 1.0 - d * 1.5);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    particleSystem = new THREE.Points(geo, mat);
    scene.add(particleSystem);
}

function animate() {
    requestAnimationFrame(animate);
    time += 0.01;
    
    const mat = particleSystem.material;
    mat.uniforms.uTime.value = time;
    mat.uniforms.uShape.value = THREE.MathUtils.lerp(mat.uniforms.uShape.value, targetShape, 0.05);

    state.zoomDist = THREE.MathUtils.lerp(state.zoomDist, state.targetZoom, 0.1);
    camera.position.z = state.zoomDist;

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});