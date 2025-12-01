// --- Elementos DOM ---
const audio = document.getElementById('audioElement');
const btnPlayPause = document.getElementById('btnPlayPause');
const iconPlay = btnPlayPause.querySelector('.icon-play');
const iconPause = btnPlayPause.querySelector('.icon-pause');
const progressBarWrap = document.getElementById('progressBarWrap');
const progressBarFill = document.getElementById('progressBarFill');
const progressThumb = document.getElementById('progressThumb');
const timeCurrent = document.getElementById('currentTime');
const timeTotal = document.getElementById('totalTime');
const lyricsContent = document.getElementById('lyricsContent');
const visualizerCanvas = document.getElementById('visualizerCanvas');
const bgCanvas = document.getElementById('bgCanvas');

// Elementos do Loader
const loaderOverlay = document.getElementById('loaderOverlay');
const loadingBar = document.getElementById('loadingBar');
const percentText = document.getElementById('percentText');
const startBtn = document.getElementById('startExperienceBtn');
const loadingText = document.getElementById('loadingText');
const appContainer = document.getElementById('appContainer');

// --- Variáveis de Estado ---
let isPlaying = false;
let currentLineIndex = -1;
let audioContext, analyser, dataArray, source;
let isDragging = false;
let animationFrameId;
let lyrics = [];
let audioBlobUrl = null;

// --- SISTEMA DE PRELOAD (BUFFERING KILLER) ---
async function initApp() {
    try {
        const audioUrl = 'SE-TW.mp3';
        
        // 1. Fetch com leitura de stream para barra de progresso
        const response = await fetch(audioUrl);
        const contentLength = +response.headers.get('Content-Length');
        
        // Fallback se não tiver Content-Length (alguns servidores locais não mandam)
        const total = contentLength || 8000000; // Estima 8MB
        
        const reader = response.body.getReader();
        let receivedLength = 0;
        let chunks = [];

        while(true) {
            const {done, value} = await reader.read();
            if (done) break;
            
            chunks.push(value);
            receivedLength += value.length;
            
            // Atualiza UI
            const percent = Math.min(100, Math.round((receivedLength / total) * 100));
            loadingBar.style.width = `${percent}%`;
            percentText.textContent = `${percent}%`;
        }

        // 2. Cria o Blob (Arquivo local na memória)
        const blob = new Blob(chunks);
        audioBlobUrl = URL.createObjectURL(blob);
        audio.src = audioBlobUrl;

        // 3. Tudo pronto
        loadingText.textContent = "Tudo pronto para você! 💝";
        loadingBar.style.background = "#4ade80"; // Verde sucesso
        startBtn.classList.add('visible'); // Mostra botão de entrar

    } catch (error) {
        console.error("Erro no carregamento:", error);
        loadingText.textContent = "Erro ao carregar o amor... Tente recarregar.";
    }
}

// Inicia o download assim que o script roda
initApp();

// Botão de Entrada (Necessário para desbloquear AudioContext no navegador)
startBtn.addEventListener('click', () => {
    // Esconde loader
    loaderOverlay.classList.add('hidden');
    // Mostra app
    appContainer.classList.add('visible');
    
    // Inicia contexto de áudio
    initAudioContext();
    audioContext.resume().then(() => {
        // Tenta tocar (pode falhar se o blob não carregou 100%, mas o botão só aparece se carregou)
        togglePlay();
    });
});

// --- LETRA EMBUTIDA ---
const lyricsText = `
[00:01.51]I only met you in my dreams before
[00:04.85]When I was young and alone in the world
[00:08.69]You were there when I needed someone
[00:12.25]To call my girl
[00:15.93]And now you're my reality
[00:19.10]And I wanna feel you close
[00:22.54]But you're defeated baby
[00:24.87]Broken hurtin' sufferin' from a shattered soul
[00:31.58]Oh a shattered soul oh
[00:44.41]Let me be there
[00:46.28]Let me be there for your heart
[00:51.27]Let me be there
[00:53.14]I can be there 'til you're whole
[00:58.55]You weren't touched by a man in so long
[01:02.10]'Cause the last time it was way too strong
[01:05.60]Let me be there
[01:07.57]Let me be there for your heart
[01:12.59]Let me love you
[01:14.76]Let me love you like you need
[01:19.88]And I'll make it
[01:21.65]Make it my responsibility
[01:27.06]I'll be there every step of the way
[01:31.05]I'll get you back on your feet
[01:34.22]Let me love you
[01:35.94]Let me love you like you need
[01:41.14]And you can kick me
[01:42.98]Kick me to the curb
[01:48.40]It's okay baby
[01:50.27]I promise that I felt worse
[01:55.83]Back then I was starry eyed
[01:59.61]And now I'm so cynical
[02:02.60]Baby break me
[02:04.66]Kick me to the curb
[02:09.18]Oh
`;

// --- Parser LRC ---
function parseLyrics() {
    const lines = lyricsText.split('\n');
    const regex = /^\[(\d{2}):(\d{2}(?:\.\d+)?)\](.*)/;
    
    lyrics = lines.map(line => {
        const match = line.match(regex);
        if (!match) return null;
        const min = parseInt(match[1]);
        const sec = parseFloat(match[2]);
        const content = match[3].trim();
        return {
            time: min * 60 + sec,
            text: content || "♪"
        };
    }).filter(l => l !== null);
    
    renderLyricsHTML();
}

function renderLyricsHTML() {
    lyricsContent.innerHTML = '';
    lyrics.forEach((line, index) => {
        const div = document.createElement('div');
        div.className = 'lyric-line';
        div.textContent = line.text;
        div.dataset.index = index;
        div.onclick = () => {
            audio.currentTime = line.time;
            if (!isPlaying) togglePlay();
        };
        lyricsContent.appendChild(div);
    });
}

// --- Visualizador de Áudio ---
function initAudioContext() {
    if (audioContext) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    
    analyser.smoothingTimeConstant = 0.85;
    analyser.fftSize = 256; 
    
    // Importante: reconectar o elemento se o src mudou (blob)
    source = audioContext.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    
    dataArray = new Uint8Array(analyser.frequencyBinCount);
}

function drawVisualizer() {
    if (!isPlaying) return;

    const ctx = visualizerCanvas.getContext('2d');
    const width = visualizerCanvas.width;
    const height = visualizerCanvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = 105;

    analyser.getByteFrequencyData(dataArray);
    ctx.clearRect(0, 0, width, height);

    ctx.beginPath();
    ctx.shadowBlur = 15;
    ctx.shadowColor = "rgba(236, 72, 153, 0.6)"; 
    
    const barWidth = (Math.PI * 2) / dataArray.length;
    
    for (let i = 0; i < dataArray.length; i++) {
        if (i > dataArray.length * 0.7) continue; 

        const val = dataArray[i];
        const barHeight = (val / 255) * 45; 
        const angle = i * barWidth - (Math.PI / 2);

        const x1 = centerX + Math.cos(angle) * radius;
        const y1 = centerY + Math.sin(angle) * radius;
        const x2 = centerX + Math.cos(angle) * (radius + barHeight);
        const y2 = centerY + Math.sin(angle) * (radius + barHeight);

        const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
        gradient.addColorStop(0, '#c084fc');
        gradient.addColorStop(1, '#ec4899');

        ctx.strokeStyle = gradient;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }
    
    const averageFreq = dataArray.reduce((a,b) => a+b) / dataArray.length;
    const scale = 1 + (averageFreq / 255) * 0.08;
    document.querySelector('.album-art').style.transform = `scale(${scale})`;

    requestAnimationFrame(drawVisualizer);
}

// --- Sincronização e Loop Principal ---

function syncLyrics() {
    const time = audio.currentTime;
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
        if (lyrics[i].time <= time) {
            idx = i;
        } else {
            break; 
        }
    }

    if (idx !== currentLineIndex) {
        if (currentLineIndex !== -1 && lyricsContent.children[currentLineIndex]) {
            lyricsContent.children[currentLineIndex].classList.remove('active');
        }
        
        if (idx !== -1 && lyricsContent.children[idx]) {
            const el = lyricsContent.children[idx];
            el.classList.add('active');
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        
        currentLineIndex = idx;
    }
}

function updateProgress() {
    if (isPlaying) {
        requestAnimationFrame(updateProgress);
    }

    const current = audio.currentTime;
    const dur = audio.duration || 1;
    
    timeCurrent.textContent = formatTime(current);
    syncLyrics(); 

    if (!isDragging) {
        const percent = (current / dur) * 100;
        progressBarFill.style.width = `${percent}%`;
        progressThumb.style.left = `${percent}%`;
    }
}

// --- Controles de Áudio ---
function togglePlay() {
    // initAudioContext chamado no botão de entrada
    
    if (audio.paused) {
        audioContext.resume().then(() => {
            audio.play().then(() => {
                isPlaying = true;
                iconPlay.style.display = 'none';
                iconPause.style.display = 'block';
                drawVisualizer();
                updateProgress();
            }).catch(e => console.error("Erro no play:", e));
        });
    } else {
        audio.pause();
        isPlaying = false;
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
    }
}

function formatTime(s) {
    if (!isFinite(s)) return "0:00";
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
}

// --- Lógica de Barra de Progresso ---

function calculateSeek(e) {
    const rect = progressBarWrap.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let x = clientX - rect.left;
    x = Math.max(0, Math.min(x, rect.width));
    const percent = x / rect.width;
    return percent;
}

function handleSeekMove(e) {
    if (!isDragging) return;
    e.preventDefault(); 

    const percent = calculateSeek(e);
    
    progressBarFill.style.width = `${percent * 100}%`;
    progressThumb.style.left = `${percent * 100}%`;
    
    const newTime = percent * audio.duration;
    if (isFinite(newTime)) {
        audio.currentTime = newTime;
        timeCurrent.textContent = formatTime(newTime);
        syncLyrics(); 
    }
}

function startDrag(e) {
    isDragging = true;
    handleSeekMove(e); 
    document.addEventListener('mousemove', handleSeekMove);
    document.addEventListener('touchmove', handleSeekMove, { passive: false });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);
}

function endDrag(e) {
    if (!isDragging) return;
    isDragging = false;
    
    document.removeEventListener('mousemove', handleSeekMove);
    document.removeEventListener('touchmove', handleSeekMove);
    document.removeEventListener('mouseup', endDrag);
    document.removeEventListener('touchend', endDrag);
    
    if (!isPlaying) {
        updateProgress(); 
    }
}

btnPlayPause.addEventListener('click', togglePlay);

// Inicialização de Metadata e Lyrics
// Nota: loadedmetadata dispara quando o blob é atribuído
audio.addEventListener('loadedmetadata', () => {
    timeTotal.textContent = formatTime(audio.duration);
    parseLyrics();
});

audio.addEventListener('ended', () => {
    isPlaying = false;
    iconPlay.style.display = 'block';
    iconPause.style.display = 'none';
    progressBarFill.style.width = '0%';
    progressThumb.style.left = '0%';
});

progressBarWrap.addEventListener('mousedown', startDrag);
progressBarWrap.addEventListener('touchstart', startDrag, { passive: false });

audio.addEventListener('timeupdate', () => {
    if (!isPlaying && !isDragging) {
        timeCurrent.textContent = formatTime(audio.currentTime);
        const percent = (audio.currentTime / audio.duration) * 100 || 0;
        progressBarFill.style.width = `${percent}%`;
        progressThumb.style.left = `${percent}%`;
        syncLyrics();
    }
});


// --- PARTÍCULAS DE CORAÇÃO ---
const bgCtx = bgCanvas.getContext('2d');
let particles = [];

function resizeBg() {
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeBg);
resizeBg();

class HeartParticle {
    constructor() {
        this.reset();
        this.y = Math.random() * bgCanvas.height; 
    }
    
    reset() {
        this.x = Math.random() * bgCanvas.width;
        this.y = bgCanvas.height + 20;
        this.size = Math.random() * 15 + 8;
        this.speedY = Math.random() * 1.5 + 0.5;
        this.speedX = Math.random() * 0.5 - 0.25;
        this.opacity = Math.random() * 0.4 + 0.1;
        this.rotation = Math.random() * 360;
        this.color = Math.random() > 0.6 ? '#ec4899' : '#a855f7'; 
    }
    
    update() {
        this.y -= this.speedY;
        this.x += this.speedX;
        this.rotation += 0.5;
        
        if (this.y < -50) this.reset();
    }
    
    draw() {
        bgCtx.save();
        bgCtx.globalAlpha = this.opacity;
        bgCtx.translate(this.x, this.y);
        bgCtx.rotate(this.rotation * Math.PI / 180);
        bgCtx.fillStyle = this.color;
        bgCtx.font = `${this.size}px Arial`;
        bgCtx.fillText("❤", 0, 0);
        bgCtx.restore();
    }
}

for(let i=0; i<50; i++) particles.push(new HeartParticle());

function animateBg() {
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    
    const grad = bgCtx.createLinearGradient(0, 0, 0, bgCanvas.height);
    grad.addColorStop(0, '#0f172a'); 
    grad.addColorStop(1, '#1e1b4b');
    bgCtx.fillStyle = grad;
    bgCtx.fillRect(0,0,bgCanvas.width, bgCanvas.height);

    particles.forEach(p => {
        p.update();
        p.draw();
    });
    requestAnimationFrame(animateBg);
}
animateBg();