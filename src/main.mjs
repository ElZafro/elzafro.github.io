import { drawSvg } from "./fourier.mjs";

(async () => {
    const images = [
        "images/mistborn.svg",
    ];

    const svgs = await Promise.all(images.map(x => fetch(x).then(x => x.text())));
    drawSvg(svgs[0], document.getElementById("final"));
})();
