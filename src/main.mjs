import { drawSvg } from "./fourier.mjs";

(async () => {
    //Highlight styles
    const highlighted = document.querySelectorAll('.highlighted');
    const palettes = [
        ["#00ff87", "#60efff"],
        ["#be4ffe", "#fe00cb"],
        ["#ff0055", "#ff5000"],
    ]
    const palette = palettes[Math.floor(Math.random() * palettes.length)];
    const dynamicGradient = `linear-gradient(135deg, ${palette[0]} 0%, ${palette[1]} 100%)`;
    highlighted.forEach(x => {
        x.style.backgroundImage = dynamicGradient;
    });

    // Canvas
    const canvas = document.getElementById("final");
    const images = [
        "2k.svg",
        "vulkan.svg",
    ];
    const image = images[Math.floor(Math.random() * images.length)];
    fetch(`images/${image}`)
        .then(x => x.text())
        .then(x => drawSvg(x, canvas, palette));
})();
