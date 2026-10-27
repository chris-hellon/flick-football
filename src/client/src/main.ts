import "./style.css";
import { App } from "./ui/app";
import { initConsent } from "./ui/consent";
import { initInstall, initTip } from "./ui/install";

const app = new App();
initConsent(__GA_ID__);
initInstall();
initTip(__TIP_URL__);

// Development builds expose the app for debugging in the console (window.flick.match etc.).
if (import.meta.env.DEV) Object.assign(window, { flick: app });
