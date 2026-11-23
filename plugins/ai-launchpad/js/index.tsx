import { Stores } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'
import { useState, type ReactNode } from 'react'
import {
	ActivityIndicator,
	Modal,
	SafeAreaView,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from 'react-native'
import { ChatBox, type ModelOption } from './ChatBox'
import {
	sendToProvider,
	type ChatAttachment,
	type ChatMessage,
	type ProviderConfig,
	type ProviderType,
} from './providers'

interface ChatSession {
	id: string
	title: string
	updatedAt: number
	messages: ChatMessage[]
}

interface StorageData {
	openaiKey: string
	openaiBaseUrl: string
	claudeKey: string
	claudeBaseUrl: string
	googleKey: string
	googleBaseUrl: string
	systemPrompt: string
	selectedModel: ModelOption
	sessions: ChatSession[]
}

const DEFAULT_MODELS: ModelOption[] = [
	{ id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet', provider: 'claude' },
	{ id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
	{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google' },
]

const DefaultStorage: StorageData = {
	openaiKey: '',
	openaiBaseUrl: 'https://api.openai.com/v1',
	claudeKey: '',
	claudeBaseUrl: 'https://api.anthropic.com/v1',
	googleKey: '',
	googleBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
	systemPrompt: 'You are a helpful assistant inside Discord mobile.',
	selectedModel: DEFAULT_MODELS[0],
	sessions: [],
}

function getChannelContext(limit = 25): string {
	const storeMap = Stores as unknown as Record<
		string,
		Record<string, (...args: unknown[]) => unknown>
	>
	const channelId = storeMap.SelectedChannelStore?.getChannelId?.() as
		| string
		| undefined
	if (!channelId) return ''
	const msgCollection = storeMap.MessageStore?.getMessages?.(channelId) as
		| { toArray?: () => { author?: { username?: string }; content?: string }[] }
		| undefined
	const msgs = msgCollection?.toArray?.() ?? []
	return msgs
		.slice(-limit)
		.map(m => `${m.author?.username ?? 'User'}: ${m.content ?? ''}`)
		.filter(line => line.trim().length > 0)
		.join('\n')
}

function getConfigForModel(
	model: ModelOption,
	data: StorageData,
): ProviderConfig {
	const map: Record<ProviderType, { apiKey: string; baseUrl: string }> = {
		openai: { apiKey: data.openaiKey, baseUrl: data.openaiBaseUrl },
		claude: { apiKey: data.claudeKey, baseUrl: data.claudeBaseUrl },
		google: { apiKey: data.googleKey, baseUrl: data.googleBaseUrl },
	}
	return {
		provider: model.provider,
		model: model.id,
		apiKey: map[model.provider].apiKey,
		baseUrl: map[model.provider].baseUrl || undefined,
	}
}

export function AILaunchpadScreen({
	data,
	onSave,
	onClose,
	pickPhoto,
	pickFile,
}: {
	data: StorageData
	onSave: (patch: Partial<StorageData>) => void
	onClose?: () => void
	pickPhoto: () => Promise<ChatAttachment | null>
	pickFile: () => Promise<ChatAttachment | null>
}) {
	const [sessions, setSessions] = useState<ChatSession[]>(data.sessions ?? [])
	const [activeId, setActiveId] = useState<string | null>(
		sessions[0]?.id ?? null,
	)
	const [showHistory, setShowHistory] = useState(false)
	const [selectedModel, setSelectedModel] = useState<ModelOption>(
		data.selectedModel ?? DEFAULT_MODELS[0],
	)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const activeSession = sessions.find(s => s.id === activeId) ?? null

	const saveSessions = (next: ChatSession[]) => {
		setSessions(next)
		onSave({ sessions: next })
	}

	const createNewChat = () => {
		const fresh: ChatSession = {
			id: String(Date.now()),
			title: 'New Chat',
			updatedAt: Date.now(),
			messages: [],
		}
		saveSessions([fresh, ...sessions])
		setActiveId(fresh.id)
		setShowHistory(false)
		setError(null)
	}

	const handleSend = async (text: string, attachments: ChatAttachment[]) => {
		setError(null)
		let current = activeSession
		let nextSessions = [...sessions]

		if (!current) {
			current = {
				id: String(Date.now()),
				title: text.slice(0, 32) || 'New Chat',
				updatedAt: Date.now(),
				messages: [],
			}
			nextSessions = [current, ...nextSessions]
			setActiveId(current.id)
		}

		const userMsg: ChatMessage = { role: 'user', text, attachments }
		const updatedMessages = [...current.messages, userMsg]
		current = {
			...current,
			title:
				current.messages.length === 0 && text
					? text.slice(0, 32)
					: current.title,
			updatedAt: Date.now(),
			messages: updatedMessages,
		}
		nextSessions = nextSessions.map(s => (s.id === current?.id ? current : s))
		saveSessions(nextSessions)

		setLoading(true)
		try {
			const cfg = getConfigForModel(selectedModel, data)
			if (!cfg.apiKey) {
				throw new Error(
					`Missing API key for ${cfg.provider} in plugin settings.`,
				)
			}
			const reply = await sendToProvider(
				cfg,
				updatedMessages,
				data.systemPrompt,
			)
			const assistantMsg: ChatMessage = { role: 'assistant', text: reply }
			const finalSession: ChatSession = {
				...current,
				updatedAt: Date.now(),
				messages: [...updatedMessages, assistantMsg],
			}
			saveSessions(
				nextSessions.map(s => (s.id === finalSession.id ? finalSession : s)),
			)
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Request failed')
		} finally {
			setLoading(false)
		}
	}

	const handleSummarizeContext = () => {
		const context = getChannelContext(25)
		if (!context) {
			setError('No recent channel messages found to summarize.')
			return
		}
		handleSend(
			`Summarize the key points from this Discord channel context:\n\n${context}`,
			[],
		)
	}

	return (
		<SafeAreaView style={styles.container}>
			<View style={styles.header}>
				<View style={styles.headerLeft}>
					{onClose && (
						<TouchableOpacity style={styles.headerBtn} onPress={onClose}>
							<Text style={styles.headerBtnText}>Close</Text>
						</TouchableOpacity>
					)}
					<TouchableOpacity
						style={styles.headerBtn}
						onPress={() => setShowHistory(v => !v)}
					>
						<Text style={styles.headerBtnText}>History</Text>
					</TouchableOpacity>
				</View>
				<View style={styles.headerRight}>
					<TouchableOpacity
						style={styles.headerBtn}
						onPress={handleSummarizeContext}
					>
						<Text style={styles.headerBtnText}>Summarize</Text>
					</TouchableOpacity>
					<TouchableOpacity style={styles.newChatBtn} onPress={createNewChat}>
						<Text style={styles.newChatText}>+</Text>
					</TouchableOpacity>
				</View>
			</View>

			{showHistory && (
				<ScrollView style={styles.historyList}>
					{sessions.length === 0 && (
						<Text style={styles.emptyText}>No saved chats yet.</Text>
					)}
					{sessions.map(s => (
						<TouchableOpacity
							key={s.id}
							style={[
								styles.historyItem,
								s.id === activeId && styles.historyActive,
							]}
							onPress={() => {
								setActiveId(s.id)
								setShowHistory(false)
							}}
						>
							<Text style={styles.historyTitle} numberOfLines={1}>
								{s.title}
							</Text>
						</TouchableOpacity>
					))}
				</ScrollView>
			)}

			<ScrollView style={styles.messages}>
				{(!activeSession || activeSession.messages.length === 0) && (
					<Text style={styles.emptyText}>
						Ask anything or tap Summarize to read this channel.
					</Text>
				)}
				{activeSession?.messages.map((m, idx) => (
					<View
						key={`${activeSession.id}-${idx}`}
						style={[
							styles.msgBubble,
							m.role === 'user' ? styles.userBubble : styles.aiMsgBubble,
						]}
					>
						<Text style={styles.msgText} selectable>
							{m.text}
						</Text>
					</View>
				))}
				{loading && (
					<ActivityIndicator color="#5865f2" style={{ marginVertical: 10 }} />
				)}
				{error && <Text style={styles.errorText}>{error}</Text>}
			</ScrollView>

			<ChatBox
				models={DEFAULT_MODELS}
				selectedModel={selectedModel}
				onSelectModel={m => {
					setSelectedModel(m)
					onSave({ selectedModel: m })
				}}
				onPickPhoto={pickPhoto}
				onPickFile={pickFile}
				onSummarizeContext={handleSummarizeContext}
				onSend={handleSend}
			/>
		</SafeAreaView>
	)
}

function LaunchpadWithAI({
	children,
	storage,
}: {
	children: ReactNode
	storage: { use: () => StorageData | undefined; set: (p: Partial<StorageData>) => void }
}) {
	const [open, setOpen] = useState(false)
	const data = { ...DefaultStorage, ...(storage.use() ?? {}) }

	return (
		<View style={{ flex: 1 }}>
			{children}
			<TouchableOpacity
				style={styles.floatingAI}
				onPress={() => setOpen(true)}
			>
				<Text style={styles.floatingAIText}>AI</Text>
			</TouchableOpacity>
			<Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
				<AILaunchpadScreen
					data={data}
					onSave={patch => storage.set(patch)}
					onClose={() => setOpen(false)}
					pickPhoto={async () => null}
					pickFile={async () => null}
				/>
			</Modal>
		</View>
	)
}

export default plugin<{ jsonStorage: StorageData }>({
	jsonStorage: {
		load: true,
		default: DefaultStorage,
	},
	start({ cleanup, jsonStorage }) {
		cleanup(
			getModules(
				withName<Record<string, (...args: unknown[]) => unknown>>('Launchpad'),
				mod => {
					if (!('default' in mod) || typeof mod.default !== 'function') return
					cleanup(
						after(mod, 'default', res => (
							<LaunchpadWithAI storage={jsonStorage}>
								{res as ReactNode}
							</LaunchpadWithAI>
						)),
					)
				},
			),
		)
	},
	SettingsComponent({ api: { jsonStorage } }) {
		const [chatOpen, setChatOpen] = useState(false)
		const stored = { ...DefaultStorage, ...(jsonStorage.use() ?? {}) }

		const update = <K extends keyof StorageData>(
			key: K,
			value: StorageData[K],
		) => {
			jsonStorage.set({ [key]: value })
		}

		return (
			<ScrollView style={styles.settingsPage}>
				<TouchableOpacity
					style={styles.openChatBtn}
					onPress={() => setChatOpen(true)}
				>
					<Text style={styles.openChatBtnText}>Open AI Chat</Text>
				</TouchableOpacity>

				<Modal
					visible={chatOpen}
					animationType="slide"
					onRequestClose={() => setChatOpen(false)}
				>
					<AILaunchpadScreen
						data={stored}
						onSave={patch => jsonStorage.set(patch)}
						onClose={() => setChatOpen(false)}
						pickPhoto={async () => null}
						pickFile={async () => null}
					/>
				</Modal>

				<Text style={styles.sectionTitle}>Claude (Anthropic)</Text>
				<TextInput
					style={styles.settingInput}
					placeholder="API Key (sk-ant-...)"
					placeholderTextColor="#8e9297"
					secureTextEntry
					value={stored.claudeKey}
					onChangeText={v => update('claudeKey', v)}
				/>
				<TextInput
					style={styles.settingInput}
					placeholder="Base URL"
					placeholderTextColor="#8e9297"
					value={stored.claudeBaseUrl}
					onChangeText={v => update('claudeBaseUrl', v)}
				/>

				<Text style={styles.sectionTitle}>OpenAI</Text>
				<TextInput
					style={styles.settingInput}
					placeholder="API Key (sk-...)"
					placeholderTextColor="#8e9297"
					secureTextEntry
					value={stored.openaiKey}
					onChangeText={v => update('openaiKey', v)}
				/>
				<TextInput
					style={styles.settingInput}
					placeholder="Base URL"
					placeholderTextColor="#8e9297"
					value={stored.openaiBaseUrl}
					onChangeText={v => update('openaiBaseUrl', v)}
				/>

				<Text style={styles.sectionTitle}>Google Gemini</Text>
				<TextInput
					style={styles.settingInput}
					placeholder="API Key (AIza...)"
					placeholderTextColor="#8e9297"
					secureTextEntry
					value={stored.googleKey}
					onChangeText={v => update('googleKey', v)}
				/>
				<TextInput
					style={styles.settingInput}
					placeholder="Base URL"
					placeholderTextColor="#8e9297"
					value={stored.googleBaseUrl}
					onChangeText={v => update('googleBaseUrl', v)}
				/>
			</ScrollView>
		)
	},
})

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: '#1e1f22' },
	header: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		padding: 10,
		borderBottomWidth: 1,
		borderColor: '#2b2d31',
	},
	headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
	headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
	headerBtn: {
		backgroundColor: '#2b2d31',
		borderRadius: 10,
		paddingHorizontal: 10,
		paddingVertical: 6,
	},
	headerBtnText: { color: '#dbdee1', fontSize: 12, fontWeight: '600' },
	newChatBtn: {
		width: 30,
		height: 30,
		borderRadius: 15,
		backgroundColor: '#5865f2',
		alignItems: 'center',
		justifyContent: 'center',
	},
	newChatText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
	historyList: { maxHeight: 160, backgroundColor: '#111214', padding: 8 },
	historyItem: { padding: 10, borderRadius: 8, marginBottom: 4 },
	historyActive: { backgroundColor: '#2b2d31' },
	historyTitle: { color: '#dbdee1', fontSize: 13 },
	messages: { flex: 1, padding: 10 },
	emptyText: {
		color: '#949ba4',
		textAlign: 'center',
		marginTop: 24,
		fontSize: 13,
	},
	msgBubble: {
		padding: 10,
		borderRadius: 12,
		marginBottom: 8,
		maxWidth: '88%',
	},
	userBubble: { alignSelf: 'flex-end', backgroundColor: '#5865f2' },
	aiMsgBubble: { alignSelf: 'flex-start', backgroundColor: '#2b2d31' },
	msgText: { color: '#f2f3f5', fontSize: 14 },
	errorText: { color: '#f23f42', fontSize: 12, marginTop: 6 },
	floatingAI: {
		position: 'absolute',
		top: 14,
		right: 14,
		backgroundColor: '#5865f2',
		borderRadius: 18,
		paddingHorizontal: 14,
		paddingVertical: 8,
		elevation: 6,
	},
	floatingAIText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
	settingsPage: { flex: 1, padding: 14, backgroundColor: '#1e1f22' },
	openChatBtn: {
		backgroundColor: '#5865f2',
		borderRadius: 12,
		paddingVertical: 12,
		alignItems: 'center',
		marginBottom: 8,
	},
	openChatBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
	sectionTitle: {
		color: '#f2f3f5',
		fontSize: 14,
		fontWeight: '700',
		marginTop: 14,
		marginBottom: 6,
	},
	settingInput: {
		backgroundColor: '#2b2d31',
		color: '#f2f3f5',
		borderRadius: 10,
		paddingHorizontal: 12,
		paddingVertical: 8,
		marginBottom: 8,
		fontSize: 13,
	},
})
