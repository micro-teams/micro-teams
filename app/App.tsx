/*
 * The app root: providers, then the sign-in screen or the shell.
 *
 * <App /> — registered by index.ts. routes — every frame the display stack can hold, by name.
 *
 * Example: registerRootComponent(App)
 *
 * The font is loaded before anything is drawn: the whole UI is monospace and a first frame in a
 * fallback face would visibly jump when it arrives.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SignIn } from "./src/features/auth/SignIn";
import { ChatsScreen } from "./src/features/chats/ChatsScreen";
import { AgentScreen } from "./src/features/agents/AgentScreen";
import { DocDiffScreen, DocHistoryScreen } from "./src/features/docs/DocHistoryScreen";
import { DocScreen } from "./src/features/docs/DocScreen";
import { DocsScreen } from "./src/features/docs/DocsScreen";
import { AgentsScreen } from "./src/features/agents/AgentsScreen";
import { ConnectScreen } from "./src/features/agents/ConnectScreen";
import { MachineScreen } from "./src/features/agents/MachineScreen";
import { ThreadInfoScreen } from "./src/features/chats/ThreadInfoScreen";
import { ThreadScreen } from "./src/features/chats/ThreadScreen";
import { TeamScreen, TeamsScreen } from "./src/features/teams/TeamsScreen";
import { ScreenFrame } from "./src/features/terminal/ScreenFrame";
import { LinesScreen, MeScreen } from "./src/features/me/MeScreen";
import { SessionProvider, useSession } from "./src/data/session";
import { NavProvider } from "./src/nav/NavProvider";
import { Shell } from "./src/nav/Shell";
import { DialogFrame } from "./src/ui/Dialog";
import { ToastProvider } from "./src/ui/Toast";

const LIBERATION_MONO = require("./assets/fonts/LiberationMono-Regular.ttf");

export const routes = {
  chats: ChatsScreen,
  thread: ThreadScreen,
  threadInfo: ThreadInfoScreen,
  docs: DocsScreen,
  doc: DocScreen,
  docHistory: DocHistoryScreen,
  docDiff: DocDiffScreen,
  agents: AgentsScreen,
  agent: AgentScreen,
  machine: MachineScreen,
  connect: ConnectScreen,
  me: MeScreen,
  lines: LinesScreen,
  dialog: DialogFrame,
  screen: ScreenFrame,
  teams: TeamsScreen,
  team: TeamScreen,
};

const queries = new QueryClient();

function Root() {
  const { user } = useSession();
  return user ? (
    <NavProvider key={user.id}>
      <Shell routes={routes} />
    </NavProvider>
  ) : (
    <SignIn />
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ LiberationMono: LIBERATION_MONO });
  if (fontError) throw fontError;
  if (!fontsLoaded) return null;
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <QueryClientProvider client={queries}>
          <SessionProvider>
            <ToastProvider>
              <Root />
            </ToastProvider>
          </SessionProvider>
        </QueryClientProvider>
      </KeyboardProvider>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
