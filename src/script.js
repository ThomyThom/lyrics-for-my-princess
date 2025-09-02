const audio = document.getElementById('audio');
const playpause = document.getElementById('playpause');
const stopBtn = document.getElementById('stop');
const seekbar = document.getElementById('seekbar');
const seekfill = document.getElementById('seekfill');
const leftTime = document.getElementById('leftTime');
const rightTime = document.getElementById('rightTime');
const karaoke = document.getElementById('karaoke');
// Removido: const audioFile = document.getElementById('audioFile');
const songTitle = document.getElementById('songTitle');
const songHint = document.getElementById('songHint');

let timeline = [];
let rafId = null;
let isSeeking = false;

// MELHORIA: Variáveis para a rolagem ultra-suave
let currentScrollTop = 0;
let targetScrollTop = 0;

function fmt(t) {
    if (!isFinite(t)) return '00:00';
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2,'0')}`;
}

function parseTimestamp(str) {
    const m = str.match(/(?:(\d+):)?(\d{1,2})(?:\.(\d{1,3}))?/);
    if (!m) return 0;
    const min = parseInt(m[1] || '0', 10), sec = parseInt(m[2] || '0', 10), ms = parseInt((m[3] || '0').padEnd(3, '0'), 10);
    return min * 60 + sec + ms / 1000;
}

function parseLRC(text) {
    const lines = [];
    const rawLines = text.replace(/\r/g, '').split(/\n+/);
    for (const raw of rawLines) {
        if (!raw.trim()) continue;
        const lineMatch = raw.match(/^\s*\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/);
        if (!lineMatch) continue;
        const lineTime = parseTimestamp(lineMatch[1]);
        let rest = lineMatch[2];
        const words = [];
        const wordRegex = /<([0-9]{1,2}:[0-9]{2}(?:\.[0-9]{1,3})?)>([^<\s][^<]*?)(?=\s*<|$)/g;
        let m;
        while ((m = wordRegex.exec(rest))) {
            words.push({ t: parseTimestamp(m[1]), text: m[2].trim() });
        }
        if (words.length === 0) {
            const fallbackWords = rest.split(/\s+/).filter(Boolean);
            const avgDur = 0.35;
            fallbackWords.forEach((w, i) => words.push({ t: lineTime + i * avgDur, text: w }));
        }
        lines.push({ lineTime, words });
    }
    lines.sort((a, b) => a.lineTime - b.lineTime);
    for (const ln of lines) {
        for (let i = 0; i < ln.words.length; i++) {
            const cur = ln.words[i];
            const next = ln.words[i + 1] || null;
            cur.nextT = next ? next.t : (ln.words[i].t + 0.6);
        }
    }
    return lines;
}

function renderLyrics() {
    karaoke.innerHTML = '';
    timeline.forEach((ln, idx) => {
        const line = document.createElement('div');
        line.className = 'line';
        line.dataset.index = idx;
        ln.words.forEach((w, wi) => {
            const wrap = document.createElement('span');
            wrap.className = 'word';
            wrap.dataset.t = w.t;
            wrap.dataset.next = w.nextT;
            const base = document.createElement('span'); base.className = 'base'; base.textContent = w.text + ' ';
            const glow = document.createElement('span'); glow.className = 'glow'; glow.textContent = w.text + ' ';
            wrap.appendChild(base); wrap.appendChild(glow);
            line.appendChild(wrap);
        });
        karaoke.appendChild(line);
    });
}

function findActiveLine(t) {
    let idx = -1;
    for (let i = 0; i < timeline.length; i++) {
        if (timeline[i].lineTime <= t) idx = i; else break;
    }
    return idx;
}

function updateKaraoke() {
    // Use currentTime diretamente para máxima precisão
    const t = audio.currentTime || 0;
    if (!isSeeking) {
        const dur = audio.duration || 0;
        leftTime.textContent = fmt(t);
        seekfill.style.width = dur ? `${(t / dur) * 100}%` : '0%';
        seekbar.setAttribute('aria-valuenow', dur ? Math.floor((t / dur) * 100) : 0);
    }

    const idx = findActiveLine(t);
    const lines = [...karaoke.querySelectorAll('.line')];
    lines.forEach((el, i) => el.classList.toggle('active', i === idx));

    const active = lines[idx];
    if (active) {
        const karaokeHeight = karaoke.clientHeight;
        const activeLineHeight = active.clientHeight;
        targetScrollTop = active.offsetTop - (karaokeHeight / 2) + (activeLineHeight / 2);

        const words = [...active.querySelectorAll('.word')];
        for (const w of words) {
            const start = parseFloat(w.dataset.t), next = parseFloat(w.dataset.next);
            const glow = w.querySelector('.glow');
            // Sincronização mais precisa: calcula o progresso da palavra em tempo real
            if (t >= start && t < next) {
                const p = (t - start) / (next - start);
                glow.style.clipPath = `inset(0 ${100 - Math.max(0, Math.min(1, p)) * 100}% 0 0)`;
            } else if (t >= next) {
                glow.style.clipPath = 'inset(0 0% 0 0)';
            } else {
                glow.style.clipPath = 'inset(0 100% 0 0)';
            }
        }
    }
    // Rolagem suave permanece igual
    currentScrollTop += (targetScrollTop - currentScrollTop) * 0.1;
    karaoke.scrollTop = currentScrollTop;

    // Atualização mais frequente para máxima precisão
    rafId = requestAnimationFrame(updateKaraoke);
}

function setupAudioUI() {
    const dur = audio.duration;
    leftTime.textContent = fmt(0);
    rightTime.textContent = fmt(dur);
    seekbar.setAttribute('aria-valuemax', dur);
}

// --- Event Listeners ---

playpause.addEventListener('click', () => {
    if (audio.paused) { audio.play(); playpause.textContent = '⏸ Pausar'; }
    else { audio.pause(); playpause.textContent = '▶︎ Reproduzir'; }
});

stopBtn.addEventListener('click', () => {
    audio.pause();
    audio.currentTime = 0;
    playpause.textContent = '▶︎ Reproduzir';
});

audio.addEventListener('play', () => { cancelAnimationFrame(rafId); updateKaraoke(); });
audio.addEventListener('pause', () => cancelAnimationFrame(rafId));
audio.addEventListener('loadedmetadata', setupAudioUI);
audio.addEventListener('timeupdate', () => {
    if (!isSeeking) {
        leftTime.textContent = fmt(audio.currentTime);
    }
});

// MELHORIA: Lógica completa para barra de progresso arrastável
function handleSeek(e) {
    const rect = seekbar.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const newTime = p * audio.duration;
    if (isFinite(audio.duration)) {
        audio.currentTime = newTime;
        leftTime.textContent = fmt(newTime); // Atualiza o tempo imediatamente
        seekfill.style.width = `${p * 100}%`;
    }
}
seekbar.addEventListener('mousedown', e => {
    isSeeking = true;
    handleSeek(e);
    document.addEventListener('mousemove', handleSeek);
    document.addEventListener('mouseup', () => {
        isSeeking = false;
        document.removeEventListener('mousemove', handleSeek);
    }, { once: true });
});


async function loadDefaultLRC() {
    try {
        const resp = await fetch('EI-TW.lrc');
        if (!resp.ok) throw new Error('Arquivo não encontrado');
        const txt = await resp.text();
        timeline = parseLRC(txt);
        renderLyrics();
    } catch (e) {
        karaoke.innerHTML = `<div class="line" style="opacity:1; text-align:center;">Letra não encontrada.</div>`;
        console.error("Erro ao carregar o arquivo LRC:", e);
    }
}

// --- Estado Inicial ---
karaoke.classList.remove('hide');
loadDefaultLRC();