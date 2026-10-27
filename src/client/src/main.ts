import "./style.css";
import { App } from "./ui/app";

const app = new App();

// Development builds expose the app for debugging in the console (window.flick.match etc.).
if (import.meta.env.DEV) Object.assign(window, { flick: app });
