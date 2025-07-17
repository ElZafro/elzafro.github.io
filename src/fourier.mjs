export function drawSvg(file, canvas) {

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = dpr * rect.width;
    canvas.height = dpr * rect.height;

    const offscreenCanvas = canvas.transferControlToOffscreen();

    const state = {
        pathTrace: new Array(),
        fourierCoeffs: null,
        numSamples: 2_000, //TODO: Make slider
        canvasSize: {
            width: rect.width,
            height: rect.height
        }
    }

    try {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(file, "image/svg+xml");

        const pathElement = svgDoc.querySelector('path');
        if (pathElement && pathElement.hasAttribute('d')) {
            const pathData = pathElement.getAttribute('d');
            setup(pathData, state);
            const worker = new Worker("/src/worker.mjs", { type: "module" });
            worker.postMessage({
                offscreenCanvas,
                dpr,
                state //TODO: Avoid copying state, move instead
            }, [offscreenCanvas]);
        } else {
            alert("Error: No <path> element with a 'd' attribute found in the selected SVG file.");
        }
    } catch (error) {
        console.error("Error parsing SVG file:", error);
        alert("Could not parse the selected file. Please ensure it is a valid SVG.");
    }
}

function parseSVGPath(d) {
    const pathCommands = d.replace(/[MmLl]/g, ' & ').replace(/Z/gi, '').trim();
    const pointsStr = pathCommands.split('&').filter(s => s.trim() !== '');

    let vertices = [];
    pointsStr.forEach(ps => {
        const coords = ps.trim().split(/[,\s]+/).map(Number);
        for (let i = 0; i < coords.length; i += 2) {
            if (!isNaN(coords[i]) && !isNaN(coords[i + 1])) {
                vertices.push({ x: coords[i], y: coords[i + 1] });
            }
        }
    });

    if (d.toUpperCase().includes('Z') && vertices.length > 0) {
        vertices.push(vertices[0]);
    }
    return vertices;
}

function distance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function resamplePath(vertices, n) {
    if (vertices.length < 2) return vertices;
    let totalLength = 0;
    for (let i = 0; i < vertices.length - 1; i++) {
        totalLength += distance(vertices[i], vertices[i + 1]);
    }

    const interval = totalLength / (n - 1);
    let newPoints = [vertices[0]];
    let distSinceLastSample = 0;

    for (let i = 0; i < vertices.length - 1; i++) {
        let p1 = vertices[i];
        let p2 = vertices[i + 1];
        let segmentDist = distance(p1, p2);
        if (segmentDist === 0) continue;

        let currentPosOnSegment = 0;

        while (currentPosOnSegment < segmentDist) {
            const remainingDistOnSegment = segmentDist - currentPosOnSegment;
            const distToNextSample = interval - distSinceLastSample;

            if (distToNextSample <= remainingDistOnSegment) {
                const ratio = distToNextSample / segmentDist;
                const newPoint = {
                    x: p1.x + (p2.x - p1.x) * ratio,
                    y: p1.y + (p2.y - p1.y) * ratio
                };
                newPoints.push(newPoint);
                p1 = newPoint;
                segmentDist = distance(p1, p2);
                currentPosOnSegment = 0;
                distSinceLastSample = 0;
            } else {
                distSinceLastSample += remainingDistOnSegment;
                currentPosOnSegment = segmentDist;
            }
        }
    }
    while (newPoints.length < n) {
        newPoints.push(vertices[vertices.length - 1]);
    }

    return newPoints.slice(0, n);
}

function dft(points) {
    const N = points.length;
    const coefficients = [];
    for (let k = 0; k < N; k++) {
        let sum_re = 0;
        let sum_im = 0;
        for (let n = 0; n < N; n++) {
            const angle = (2 * Math.PI * k * n) / N;
            sum_re += points[n].x * Math.cos(angle) + points[n].y * Math.sin(angle);
            sum_im += -points[n].x * Math.sin(angle) + points[n].y * Math.cos(angle);
        }
        sum_re /= N;
        sum_im /= N;
        coefficients.push({
            freq: k,
            amp: Math.sqrt(sum_re * sum_re + sum_im * sum_im),
            phase: Math.atan2(sum_im, sum_re),
        });
    }
    return coefficients;
}

function setup(svgPathData, state) {
    console.time("Parse SVG");
    const rawVertices = parseSVGPath(svgPathData);
    console.timeEnd("Parse SVG");
    if (rawVertices.length === 0) {
        alert("Could not extract any valid coordinates from the SVG path.");
        return;
    }

    const bounds = rawVertices.reduce((acc, p) => ({
        minX: Math.min(acc.minX, p.x), maxX: Math.max(acc.maxX, p.x),
        minY: Math.min(acc.minY, p.y), maxY: Math.max(acc.maxY, p.y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    const centeredVertices = rawVertices.map(p => ({ x: p.x - centerX, y: p.y - centerY }));

    const scaleX = state.canvasSize.width / (bounds.maxX - bounds.minX);
    const scaleY = state.canvasSize.height / (bounds.maxY - bounds.minY);
    const scale = Math.min(scaleX, scaleY) * 0.8;

    const scaledVertices = centeredVertices.map(p => ({ x: p.x * scale, y: p.y * scale }));

    console.time("DFT");
    const sampledPoints = resamplePath(scaledVertices, state.numSamples);
    const allCoeffs = dft(sampledPoints);
    console.timeEnd("DFT");

    const N = allCoeffs.length;
    const mappedCoeffs = [];
    for (let i = 0; i < N; i++) {
        const k = i > N / 2 ? i - N : i;
        mappedCoeffs.push({ ...allCoeffs[i], freq: k });
    }

    state.fourierCoeffs = mappedCoeffs.filter(x => x.amp >= 0.02).sort((a, b) => b.amp - a.amp);
    {
        const arr = new Array(state.numSamples);
        for (let j = 0; j < state.numSamples; j++) {
            let x = state.canvasSize.width / 2;
            let y = state.canvasSize.height / 2;
            const time = j * (2 * Math.PI) / state.numSamples;

            for (const { freq, amp, phase } of state.fourierCoeffs) {
                const angle = freq * time + phase;
                x += amp * Math.cos(angle);
                y += amp * Math.sin(angle);
            }
            arr[j] = { x, y };
        }
        state.pathTrace = arr;
    }

    return { state };
}

// Taken from https://easings.net/#easeOutExpo
function calcAlpha(x) {
    return 1 - Math.pow(2, -10 * x);
}

function lerp(x, y, t) {
    const x_r = x >> 16;
    const x_g = x >> 8 & 0xFF;
    const x_b = x & 0xFF;

    const y_r = y >> 16;
    const y_g = y >> 8 & 0xFF;
    const y_b = y & 0xFF;

    return {
        r: x_r + t * (y_r - x_r),
        g: x_g + t * (y_g - x_g),
        b: x_b + t * (y_b - x_b),
    };
}

export function animate(ctx, state, frame, dpr) {
    requestAnimationFrame(() => { animate(ctx, state, (frame + 1), dpr); });
    ctx.clearRect(0, 0, state.canvasSize.width, state.canvasSize.height);

    const startX = state.canvasSize.width / 2;
    const startY = state.canvasSize.height / 2;
    drawEpicycles(startX, startY, ctx, state, frame, dpr);

    const gradients = 64 * 2;
    const diff = Math.floor(state.numSamples / gradients);

    ctx.moveTo(state.pathTrace[0].x, state.pathTrace[0].y);
    for (let c = 0; c < gradients; c++) {

        ctx.beginPath();
        ctx.lineWidth = 2 / dpr;

        const alpha = calcAlpha((c + 1) / gradients);
        const { r, g, b } = lerp(0xbe4ffe, 0xfe00cb, c / gradients);

        ctx.strokeStyle = `rgba(
        ${r},
        ${g},
        ${b},
        ${alpha})`;

        const l = gradients - c;
        const start = (frame - l * diff + state.numSamples) % state.numSamples;
        ctx.moveTo(state.pathTrace[start].x, state.pathTrace[start].y);
        for (let i = frame - l * diff; i <= (frame - (l - 1) * diff); i++) {
            const idx = (i + state.numSamples) % state.numSamples;
            ctx.lineTo(state.pathTrace[idx].x, state.pathTrace[idx].y);
        }
        ctx.stroke();
    }
}

function drawEpicycles(x, y, ctx, state, frame, dpr) {
    const time = frame * (2 * Math.PI) / state.numSamples;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1 / dpr;
    ctx.beginPath();
    for (let i = 0; i < state.fourierCoeffs.length; i++) {
        const prev_x = x;
        const prev_y = y;
        const { freq, amp, phase } = state.fourierCoeffs[i];
        const angle = freq * time + phase;
        x += amp * Math.cos(angle);
        y += amp * Math.sin(angle);

        ctx.moveTo(prev_x + amp, prev_y);
        ctx.arc(prev_x, prev_y, amp, 0, 2 * Math.PI);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    x = state.canvasSize.width / 2;
    y = state.canvasSize.height / 2;
    for (let i = 0; i < state.fourierCoeffs.length; i++) {
        const prev_x = x;
        const prev_y = y;
        const { freq, amp, phase } = state.fourierCoeffs[i];
        const angle = freq * time + phase;
        x += amp * Math.cos(angle);
        y += amp * Math.sin(angle);

        ctx.moveTo(prev_x, prev_y);
        ctx.lineTo(x, y);
    }
    ctx.stroke();
}
