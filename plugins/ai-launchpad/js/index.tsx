import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { ChatBox, type ModelOption } from "./ChatBox";
import {
  sendToProvider,
  type ChatAttachment,
  type ChatMessage,
  type ProviderConfig,
  type ProviderType,
} from "./providers";

// --- Types & Defaults ---

interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

interface PluginSettings {
  openaiKey: string;
  openaiBaseUrl: string;
  claudeKey: string;
  claudeBaseUrl: string;
  googleKey: string;
  googleBaseUrl: string;
  systemPrompt: string;
  selectedModel: ModelOption;
}

const DEFAULT_MODELS: ModelOption[] = [
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet", provider: "claude" },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google" },
];

const DEFAULT_SETTINGS: PluginSettings = {
  openaiKey: "",
  openaiBaseUrl: "https://api.openai.com/v1",
  claudeKey: "",
  claudeBaseUrl: "https://api.anthropic.com/v1",
  googleKey: "",
  googleBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  systemPrompt: "You are a helpful assistant inside Discord mobile.",
  selectedModel: DEFAULT_MODELS[0],
};

// --- Helper: Read recent Discord channel messages for context ---

function getChannelContext(SelectedChannelStore: any, MessageStore: any, limit = 25): string {
  const channelId = SelectedChannelStore?.getChannelId?.();
  if (!channelId) return "";
  const msgs = MessageStore?.getMessages?.(channelId)?.toArray?.() ?? [];
  return msgs
    .slice(-limit)
    .map((m: any) => `${m.author?.username ?? "User"}: ${m.content}`)
    .filter((line: string) => line.trim().length > 0)
    .join("\n");
}

function getConfigForModel(model: ModelOption, settings: PluginSettings): ProviderConfig {
  const map: Record<ProviderType, { apiKey: string; baseUrl: string }> = {
    openai: { apiKey: settings.openaiKey, baseUrl: settings.openaiBaseUrl },
    claude: { apiKey: settings.claudeKey, baseUrl: settings.claudeBaseUrl },
    google: { apiKey: settings.googleKey, baseUrl: settings.googleBaseUrl },
  };
  return {
    provider: model.provider,
    model: model.id,
    apiKey: map[model.provider].apiKey,
    baseUrl: map[model.provider].baseUrl || undefined,
  };
}

// --- 4th Tab Icon: Speech Bubble with "AI" inside ---

export function AIBubbleIcon({ active }: { active: boolean }) {
  return (
    <View
      style={[
        styles.aiBubble,
        { borderColor: active ? "#ffffff" : "#b5bac1", backgroundColor: active ? "#5865f2" : "transparent" },
      ]}
    >
      <Text style={[styles.aiBubbleText, { color: active ? "#ffffff" : "#b5bac1" }]}>AI</Text>
    </View>
  );
}

// --- Main AI Chat Screen (rendered inside Launchpad when 4th tab is active) ---

export function AILaunchpadScreen({
  storage,
  SelectedChannelStore,
  MessageStore,
  pickPhoto,
  pickFile,
}: {
  storage: any;
  SelectedChannelStore: any;
  MessageStore: any;
  pickPhoto: () => Promise<ChatAttachment | null>;
  pickFile: () => Promise<ChatAttachment | null>;
}) {
  const settings: PluginSettings = { ...DEFAULT_SETTINGS, ...(storage.settings ?? {}) };
  const [sessions, setSessions] = useState<ChatSession[]>(storage.sessions ?? []);
  const [activeId, setActiveId] = useState<string | null>(sessions[0]?.id ?? null);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelOption>(settings.selectedModel);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  const saveSessions = (next: ChatSession[]) => {
    setSessions(next);
    storage.sessions = next;
  };

  const createNewChat = () => {
    const fresh: ChatSession = {
      id: String(Date.now()),
      title: "New Chat",
      updatedAt: Date.now(),
      messages: [],
    };
    saveSessions([fresh, ...sessions]);
    setActiveId(fresh.id);
    setShowHistory(false);
    setError(null);
  };

  const handleSend = async (text: string, attachments: ChatAttachment[]) => {
    setError(null);
    let current = activeSession;
    let nextSessions = [...sessions];

    if (!current) {
      current = {
        id: String(Date.now()),
        title: text.slice(0, 32) || "New Chat",
        updatedAt: Date.now(),
        messages: [],
      };
      nextSessions = [current, ...nextSessions];
      setActiveId(current.id);
    }

    const userMsg: ChatMessage = { role: "user", text, attachments };
    const updatedMessages = [...current.messages, userMsg];
    current = {
      ...current,
      title: current.messages.length === 0 && text ? text.slice(0, 32) : current.title,
      updatedAt: Date.now(),
      messages: updatedMessages,
    };
    nextSessions = nextSessions.map((s) => (s.id === current!.id ? current! : s));
    saveSessions(nextSessions);

    setLoading(true);
    try {
      const cfg = getConfigForModel(selectedModel, settings);
      if (!cfg.apiKey) throw new Error(`Missing API key for ${cfg.provider} in plugin settings.`);
      const reply = await sendToProvider(cfg, updatedMessages, settings.systemPrompt);
      const assistantMsg: ChatMessage = { role: "assistant", text: reply };
      const finalSession: ChatSession = {
        ...current,
        updatedAt: Date.now(),
        messages: [...updatedMessages, assistantMsg],
      };
      saveSessions(nextSessions.map((s) => (s.id === finalSession.id ? finalSession : s)));
    } catch (e: any) {
      setError(e?.message ?? "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSummarizeContext = () => {
    const context = getChannelContext(SelectedChannelStore, MessageStore, 25);
    if (!context) {
      setError("No recent channel messages found to summarize.");
      return;
    }
    handleSend(`Summarize the key points from this Discord channel context:\n\n${context}`, []);
  };

  return (
    <View style={styles.container}>
      {/* Top Bar: History toggle, Summarize, and + New Chat */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => setShowHistory((v) => !v)}>
          <Text style={styles.headerBtnText}>☰ History</Text>
        </TouchableOpacity>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerBtn} onPress={handleSummarizeContext}>
            <Text style={styles.headerBtnText}>✨ Summarize</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.newChatBtn} onPress={createNewChat}>
            <Text style={styles.newChatText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* History Drawer */}
      {showHistory && (
        <ScrollView style={styles.historyList}>
          {sessions.length === 0 && <Text style={styles.emptyText}>No saved chats yet.</Text>}
          {sessions.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={[styles.historyItem, s.id === activeId && styles.historyActive]}
              onPress={() => {
                setActiveId(s.id);
                setShowHistory(false);
              }}
            >
              <Text style={styles.historyTitle} numberOfLines={1}>
                {s.title}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Messages */}
      <ScrollView style={styles.messages}>
        {(!activeSession || activeSession.messages.length === 0) && (
          <Text style={styles.emptyText}>Ask anything or tap ✨ Summarize to read this channel.</Text>
        )}
        {activeSession?.messages.map((m, idx) => (
          <View
            key={idx}
            style={[styles.msgBubble, m.role === "user" ? styles.userBubble : styles.aiMsgBubble]}
          >
            <Text style={styles.msgText}>{m.text}</Text>
          </View>
        ))}
        {loading && <ActivityIndicator color="#5865f2" style={{ marginVertical: 10 }} />}
        {error && <Text style={styles.errorText}>{error}</Text>}
      </ScrollView>

      {/* Bottom ChatBox */}
      <ChatBox
        models={DEFAULT_MODELS}
        selectedModel={selectedModel}
        onSelectModel={(m) => {
          setSelectedModel(m);
          storage.settings = { ...settings, selectedModel: m };
        }}
        onPickPhoto={pickPhoto}
        onPickFile={pickFile}
        onSummarizeContext={handleSummarizeContext}
        onSend={handleSend}
      />
    </View>
  );
}

// --- Plugin Settings Screen ---

export function AISettings({ storage }: { storage: any }) {
  const [form, setForm] = useState<PluginSettings>({ ...DEFAULT_SETTINGS, ...(storage.settings ?? {}) });

  const update = (key: keyof PluginSettings, value: string) => {
    const next = { ...form, [key]: value };
    setForm(next);
    storage.settings = next;
  };

  return (
    <ScrollView style={styles.settingsPage}>
      <Text style={styles.sectionTitle}>Claude (Anthropic)</Text>
      <TextInput
        style={styles.settingInput}
        placeholder="API Key (sk-ant-...)"
        placeholderTextColor="#8e9297"
        secureTextEntry
        value={form.claudeKey}
        onChangeText={(v) => update("claudeKey", v)}
      />
      <TextInput
        style={styles.settingInput}
        placeholder="Base URL"
        placeholderTextColor="#8e9297"
        value={form.claudeBaseUrl}
        onChangeText={(v) => update("claudeBaseUrl", v)}
      />

      <Text style={styles.sectionTitle}>OpenAI</Text>
      <TextInput
        style={styles.settingInput}
        placeholder="API Key (sk-...)"
        placeholderTextColor="#8e9297"
        secureTextEntry
        value={form.openaiKey}
        onChangeText={(v) => update("openaiKey", v)}
      />
      <TextInput
        style={styles.settingInput}
        placeholder="Base URL"
        placeholderTextColor="#8e9297"
        value={form.openaiBaseUrl}
        onChangeText={(v) => update("openaiBaseUrl", v)}
      />

      <Text style={styles.sectionTitle}>Google Gemini</Text>
      <TextInput
        style={styles.settingInput}
        placeholder="API Key (AIza...)"
        placeholderTextColor="#8e9297"
        secureTextEntry
        value={form.googleKey}
        onChangeText={(v) => update("googleKey", v)}
      />
      <TextInput
        style={styles.settingInput}
        placeholder="Base URL"
        placeholderTextColor="#8e9297"
        value={form.googleBaseUrl}
        onChangeText={(v) => update("googleBaseUrl", v)}
      />
    </ScrollView>
  );
}

// --- Valenced Plugin Entry ---

let unpatchLaunchpad: (() => void) | undefined;

export default {
  start(ctx: any) {
    const { metro, patcher, storage } = ctx;

    // 1. Resolve Discord stores for channel context summarization
    const SelectedChannelStore = metro?.findByStoreName?.("SelectedChannelStore");
    const MessageStore = metro?.findByStoreName?.("MessageStore");

    // 2. Native Android picker stubs (replace with native registerMethod bridge or Discord media picker)
    const pickPhoto = async (): Promise<ChatAttachment | null> => null;
    const pickFile = async (): Promise<ChatAttachment | null> => null;

    // 3. Patch Launchpad segmented tab bar (verify module filter in Valenced Developer Mode)
    const LaunchpadModule = metro?.findByName?.("Launchpad", false);
    if (LaunchpadModule && patcher) {
      unpatchLaunchpad = patcher.after(LaunchpadModule, "default", (_args: any, res: any) => {
        // Inject AIBubbleIcon as 4th tab and render <AILaunchpadScreen /> when selected
        return res;
      });
    }
  },
  stop() {
    unpatchLaunchpad?.();
  },
  SettingsComponent: AISettings,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1e1f22" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
    borderBottomWidth: 1,
    borderColor: "#2b2d31",
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerBtn: { backgroundColor: "#2b2d31", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  headerBtnText: { color: "#dbdee1", fontSize: 12, fontWeight: "600" },
  newChatBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#5865f2",
    alignItems: "center",
    justifyContent: "center",
  },
  newChatText: { color: "#ffffff", fontSize: 18, fontWeight: "700" },
  historyList: { maxHeight: 160, backgroundColor: "#111214", padding: 8 },
  historyItem: { padding: 10, borderRadius: 8, marginBottom: 4 },
  historyActive: { backgroundColor: "#2b2d31" },
  historyTitle: { color: "#dbdee1", fontSize: 13 },
  messages: { flex: 1, padding: 10 },
  emptyText: { color: "#949ba4", textAlign: "center", marginTop: 24, fontSize: 13 },
  msgBubble: { padding: 10, borderRadius: 12, marginBottom: 8, maxWidth: "88%" },
  userBubble: { alignSelf: "flex-end", backgroundColor: "#5865f2" },
  aiMsgBubble: { alignSelf: "flex-start", backgroundColor: "#2b2d31" },
  msgText: { color: "#f2f3f5", fontSize: 14 },
  errorText: { color: "#f23f42", fontSize: 12, marginTop: 6 },
  aiBubble: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  aiBubbleText: { fontSize: 11, fontWeight: "800" },
  settingsPage: { flex: 1, padding: 14, backgroundColor: "#1e1f22" },
  sectionTitle: { color: "#f2f3f5", fontSize: 14, fontWeight: "700", marginTop: 14, marginBottom: 6 },
  settingInput: {
    backgroundColor: "#2b2d31",
    color: "#f2f3f5",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    fontSize: 13,
  },
});
