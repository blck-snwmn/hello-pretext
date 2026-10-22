import {
  layoutNextLine,
  layoutWithLines,
  prepareWithSegments,
} from "@chenglou/pretext";
import { flowText } from "../src/flow";

const api = { flowText, layoutNextLine, layoutWithLines, prepareWithSegments };

declare global {
  interface Window {
    flowTest: typeof api;
  }
}

window.flowTest = api;
