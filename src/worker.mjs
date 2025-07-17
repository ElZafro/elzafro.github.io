import { animate } from "./fourier.mjs";

console.log("worker");

self.onmessage = (msg) => {
    const { offscreenCanvas, state, dpr } = msg.data;
    const ctx = offscreenCanvas.getContext('2d');
    ctx.scale(dpr, dpr);
    animate(ctx, state, 0, dpr);
}
