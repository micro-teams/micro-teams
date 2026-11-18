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
import { MaterialIcons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { useEffect } from "react";
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
import { Splash } from "./src/ui/Splash";
import { MenuFrame } from "./src/ui/Menu";
import { ToastProvider } from "./src/ui/Toast";
import { useFirstScreen } from "./src/data/chats";
import { markReady } from "./src/platform/ready";

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
  menu: MenuFrame,
  screen: ScreenFrame,
  teams: TeamsScreen,
  team: TeamScreen,
};

const queries = new QueryClient();

function Root() {
  const { user } = useSession();
  // Drawn underneath the splash while it fills in — the chat list's first page included — and
  // shown in one piece once it has.
  const firstScreen = useFirstScreen(!!user);
  useEffect(() => {
    if (firstScreen) markReady();
  }, [firstScreen]);
  return (
    <>
      {user ? (
        <NavProvider key={user.id}>
          <Shell routes={routes} />
        </NavProvider>
      ) : (
        <SignIn />
      )}
      {!firstScreen && <Splash />}
    </>
  );
}

export default function App() {
  // The icon font too: without it every icon is blank for a moment and then pops in.
  const [fontsLoaded, fontError] = useFonts({ LiberationMono: LIBERATION_MONO, ...MaterialIcons.font });
  if (fontError) throw fontError;
  if (!fontsLoaded) return <Splash />;
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
