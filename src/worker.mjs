import { animate } from "./fourier.mjs";

self.onmessage = (msg) => {
    const { offscreenCanvas, state, dpr, palette } = msg.data;
    const ctx = offscreenCanvas.getContext('2d');
    ctx.scale(dpr, dpr);
    animate(ctx, state, 0, dpr, palette);
}
