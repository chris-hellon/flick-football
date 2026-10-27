import "./style.css";
import { drawPitch } from "./render/pitch";

const cv = document.querySelector<HTMLCanvasElement>("#cv");
if (!cv) throw new Error("Pitch canvas missing");

const redraw = (): void => drawPitch(cv);
redraw();
window.addEventListener("resize", redraw);
