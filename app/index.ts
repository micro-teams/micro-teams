/*
 * The entry point: registers App as the root component on every platform, and on the web the
 * service worker (see worker/sw.ts).
 *
 * crypto.getRandomValues is installed first, for every module after it: Hermes does not have it,
 * and the MultiPath transport draws its connection ids and WebSocket keys from it.
 */
import "react-native-get-random-values";
import { registerRootComponent } from "expo";
import App from "./App";
import { registerWorker } from "./src/platform/worker";

registerRootComponent(App);
registerWorker();
